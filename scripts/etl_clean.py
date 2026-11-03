# -*- coding: utf-8 -*-
"""
ETL 清洗：raw_orders.csv -> clean_orders.csv
步骤：
1. 主键去重
2. 日期格式统一（转 datetime，剔除非法/越界日期）
3. 数值字段类型转换
4. 缺失值处理
5. 折扣范围校验（0~0.99），异常折扣打标不删除
6. 关联 dim_customer / dim_product 修正 region、category
7. 派生字段：sales / cost_amount / gross_profit / gross_margin
输出：data/clean_orders.csv + 清洗日志
"""
from pathlib import Path
import pandas as pd
import numpy as np

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "data"
LOG = []

def log(msg):
    LOG.append(msg)
    print(msg)

# ---------- 读取 ----------
raw = pd.read_csv(DATA / "raw_orders.csv", dtype=str)
dim_customer = pd.read_csv(DATA / "dim_customer.csv", dtype=str)
dim_product = pd.read_csv(DATA / "dim_product.csv", dtype=str)

n0 = len(raw)
log(f"[读取] raw_orders.csv 共 {n0} 行")

# ---------- 1. 主键去重 ----------
raw = raw.drop_duplicates(subset="order_id", keep="first")
log(f"[去重] 删除重复 order_id：{n0 - len(raw)} 行，剩余 {len(raw)} 行")

# ---------- 2. 日期格式统一 ----------
raw["order_date"] = pd.to_datetime(raw["order_date"], errors="coerce")
bad_date = raw["order_date"].isna().sum()
raw = raw.dropna(subset=["order_date"])

# 剔除越界日期（只保留 2026-01-01 ~ 2026-10-31）
mask_range = (raw["order_date"] >= "2026-01-01") & (raw["order_date"] <= "2026-10-31")
out_of_range = (~mask_range).sum()
raw = raw[mask_range]
log(f"[日期] 非法日期 {bad_date} 行，越界日期 {out_of_range} 行，剩余 {len(raw)} 行")

# ---------- 3. 数值类型转换 ----------
num_cols = ["qty", "unit_price", "discount", "cost", "refund_amount"]
for c in num_cols:
    raw[c] = pd.to_numeric(raw[c], errors="coerce")
log(f"[类型] 数值字段转换完成，缺失分布：{raw[num_cols].isna().sum().to_dict()}")

# ---------- 4. 缺失值处理 ----------
# qty / unit_price / cost 缺失 -> 无法计算，剔除
before = len(raw)
raw = raw.dropna(subset=["qty", "unit_price", "cost"])
log(f"[缺失] 关键字段缺失剔除 {before - len(raw)} 行")

# discount 缺失 -> 视为无折扣 0；refund_amount 缺失 -> 0
raw["discount"] = raw["discount"].fillna(0.0)
raw["refund_amount"] = raw["refund_amount"].fillna(0.0)

# qty <= 0 视为无效
invalid_qty = (raw["qty"] <= 0).sum()
raw = raw[raw["qty"] > 0]
log(f"[缺失] qty<=0 剔除 {invalid_qty} 行，剩余 {len(raw)} 行")

# ---------- 5. 折扣范围校验 ----------
# 正常业务折扣 0 <= discount < 1；>=1 视为脏数据，置为 0 并打标
discount_bad = raw["discount"] >= 1
raw.loc[discount_bad, "discount"] = 0.0
log(f"[校验] 折扣>=1 置 0：{discount_bad.sum()} 行")

# 折扣 > 0.30 保留（属于异常埋点，Day 2 用于异常订单识别）
high_discount = (raw["discount"] > 0.30).sum()
log(f"[校验] 折扣>0.30（保留，标记异常）：{high_discount} 行")

# ---------- 6. 关联维度表，修正 region / category ----------
# 以客户主数据的区域为准
raw = raw.merge(
    dim_customer[["customer_id", "customer_level", "region"]].rename(
        columns={"region": "region_dim"}),
    on="customer_id", how="left"
)
# 记录原始区域与维度区域不一致的行（用于数据质量报告）
region_mismatch = (raw["region"] != raw["region_dim"]).sum()
raw["region"] = raw["region_dim"].fillna(raw["region"])
raw = raw.drop(columns=["region_dim"])
log(f"[维度] 按客户主数据修正 region：{region_mismatch} 行不一致，已以主数据为准")

# 以商品主数据的品类为准
raw = raw.merge(
    dim_product[["sku_id", "category"]].rename(columns={"category": "category_dim"}),
    on="sku_id", how="left"
)
category_mismatch = (raw["category"] != raw["category_dim"]).sum()
raw["category"] = raw["category_dim"].fillna(raw["category"])
raw = raw.drop(columns=["category_dim"])
log(f"[维度] 按商品主数据修正 category：{category_mismatch} 行不一致")

# customer_level 缺失填“普通”
raw["customer_level"] = raw["customer_level"].fillna("普通")

# ---------- 7. 派生指标字段 ----------
raw["sales"] = (raw["qty"] * raw["unit_price"] * (1 - raw["discount"])).round(2)
raw["cost_amount"] = (raw["qty"] * raw["cost"]).round(2)
raw["gross_profit"] = (raw["sales"] - raw["cost_amount"]).round(2)
raw["gross_margin"] = np.where(raw["sales"] > 0,
                               raw["gross_profit"] / raw["sales"], np.nan).round(4)
raw["ym"] = raw["order_date"].dt.strftime("%Y-%m")
raw["refund_rate"] = np.where(raw["sales"] > 0,
                              raw["refund_amount"] / raw["sales"], 0).round(4)

# ---------- 输出 ----------
out_cols = [
    "order_id", "order_date", "ym",
    "customer_id", "customer_name", "customer_level",
    "region", "city", "channel",
    "sku_id", "category",
    "qty", "unit_price", "discount", "cost",
    "sales", "cost_amount", "gross_profit", "gross_margin",
    "refund_amount", "refund_rate",
    "salesperson",
]
raw = raw[out_cols].sort_values(["order_date", "order_id"]).reset_index(drop=True)
raw.to_csv(DATA / "clean_orders.csv", index=False, encoding="utf-8-sig")

# ---------- 清洗日志落盘 ----------
log(f"[输出] clean_orders.csv 共 {len(raw)} 行，{raw['order_id'].nunique()} 个唯一订单")
log(f"[输出] 异常埋点保留情况：负毛利 {(raw['gross_margin'] < 0).sum()} 行，"
    f"折扣>30% {(raw['discount'] > 0.30).sum()} 行，"
    f"退款率>50% {(raw['refund_rate'] > 0.5).sum()} 行")

with open(DATA / "etl_log.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(LOG))