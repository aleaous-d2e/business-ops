# -*- coding: utf-8 -*-
"""
指标计算 + 导出 JSON
输入：data/clean_orders.csv, data/target.csv, data/inventory.csv, data/dim_product.csv
输出：
  web/data/dashboard.json     7 个视图块 + _meta + targetFacts（indent=2，结构清晰）
  web/data/order_facts.json   订单级明细（紧凑格式，供前端筛选联动重算）
"""
import json
from datetime import datetime
from pathlib import Path
import numpy as np
import pandas as pd

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "data"
WEB_DATA = BASE / "web" / "data"
WEB_DATA.mkdir(parents=True, exist_ok=True)


def to_num(s):
    return pd.to_numeric(s, errors="coerce").fillna(0)


def sanitize(obj):
    """numpy 标量转原生类型，NaN/Inf 转 None"""
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [sanitize(v) for v in obj]
    if isinstance(obj, float):
        return None if (np.isnan(obj) or np.isinf(obj)) else obj
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        v = float(obj)
        return None if (np.isnan(v) or np.isinf(v)) else v
    return obj


# ---------- 读取 ----------
orders = pd.read_csv(DATA / "clean_orders.csv", parse_dates=["order_date"])
target = pd.read_csv(DATA / "target.csv")
inventory = pd.read_csv(DATA / "inventory.csv")
dim_product = pd.read_csv(DATA / "dim_product.csv")

for c in ["sales", "cost_amount", "gross_profit", "refund_amount", "discount"]:
    orders[c] = to_num(orders[c])
orders["gross_margin"] = pd.to_numeric(orders["gross_margin"], errors="coerce").fillna(0)
orders["refund_rate"] = pd.to_numeric(orders["refund_rate"], errors="coerce").fillna(0)

sku_name = dict(zip(dim_product["sku_id"], dim_product["product_name"]))

# =====================================================================
# 一、KPI（全量默认视图）
# =====================================================================
def build_kpi(df, target_sum):
    sales = df["sales"].sum()
    cost = df["cost_amount"].sum()
    gp = sales - cost
    gm = gp / sales if sales > 0 else 0.0
    cnt = df["order_id"].nunique()
    aov = sales / cnt if cnt > 0 else 0.0
    refund = df["refund_amount"].sum()
    rr = refund / sales if sales > 0 else 0.0
    completion = sales / target_sum if target_sum > 0 else None
    return {
        "sales": round(float(sales), 2),
        "gross_profit": round(float(gp), 2),
        "gross_margin": round(float(gm), 4),
        "order_count": int(cnt),
        "avg_order_value": round(float(aov), 2),
        "target_sales": round(float(target_sum), 2),
        "completion_rate": round(float(completion), 4) if completion is not None else None,
        "refund_amount": round(float(refund), 2),
        "refund_rate": round(float(rr), 4),
    }


target_total = float(target["target_sales"].sum())
kpi = build_kpi(orders, target_total)

# =====================================================================
# 二、月度趋势
# =====================================================================
trend = (orders.groupby("ym")
         .agg(sales=("sales", "sum"),
              cost_amount=("cost_amount", "sum"),
              refund_amount=("refund_amount", "sum"))
         .reset_index())
trend["gross_profit"] = trend["sales"] - trend["cost_amount"]
trend["gross_margin"] = np.where(trend["sales"] > 0, trend["gross_profit"] / trend["sales"], 0)

t_by_month = target.groupby("month")["target_sales"].sum()
trend["target_sales"] = trend["ym"].map(t_by_month).fillna(0)

trend_records = [
    {
        "ym": r["ym"],
        "sales": round(float(r["sales"]), 2),
        "gross_profit": round(float(r["gross_profit"]), 2),
        "gross_margin": round(float(r["gross_margin"]), 4),
        "target_sales": round(float(r["target_sales"]), 2),
    }
    for _, r in trend.sort_values("ym").iterrows()
]

# =====================================================================
# 三、区域分析（销售额占比 / 毛利率 / 完成率）
# =====================================================================
region = (orders.groupby("region")
          .agg(sales=("sales", "sum"),
               cost_amount=("cost_amount", "sum"),
               refund_amount=("refund_amount", "sum"))
          .reset_index())
region["gross_profit"] = region["sales"] - region["cost_amount"]
region["gross_margin"] = np.where(region["sales"] > 0, region["gross_profit"] / region["sales"], 0)
total_sales = region["sales"].sum()
region["sales_share"] = np.where(total_sales > 0, region["sales"] / total_sales, 0)

t_by_region = target.groupby("region")["target_sales"].sum()
region["target_sales"] = region["region"].map(t_by_region).fillna(0)

region_records = []
for _, r in region.sort_values("sales", ascending=False).iterrows():
    cr = r["sales"] / r["target_sales"] if r["target_sales"] > 0 else None
    region_records.append({
        "region": r["region"],
        "sales": round(float(r["sales"]), 2),
        "sales_share": round(float(r["sales_share"]), 4),
        "gross_profit": round(float(r["gross_profit"]), 2),
        "gross_margin": round(float(r["gross_margin"]), 4),
        "target_sales": round(float(r["target_sales"]), 2),
        "completion_rate": round(float(cr), 4) if cr is not None else None,
    })

# =====================================================================
# 四、品类分析（销售额占比 / 毛利率；目标未拆品类，不展示完成率）
# =====================================================================
category = (orders.groupby("category")
            .agg(sales=("sales", "sum"), cost_amount=("cost_amount", "sum"))
            .reset_index())
category["gross_profit"] = category["sales"] - category["cost_amount"]
category["gross_margin"] = np.where(category["sales"] > 0, category["gross_profit"] / category["sales"], 0)
cat_total = category["sales"].sum()
category["sales_share"] = np.where(cat_total > 0, category["sales"] / cat_total, 0)

category_records = [
    {
        "category": r["category"],
        "sales": round(float(r["sales"]), 2),
        "sales_share": round(float(r["sales_share"]), 4),
        "gross_profit": round(float(r["gross_profit"]), 2),
        "gross_margin": round(float(r["gross_margin"]), 4),
    }
    for _, r in category.sort_values("sales", ascending=False).iterrows()
]

# =====================================================================
# 五、客户 TOP10
# =====================================================================
cust = (orders.groupby(["customer_id", "customer_name", "customer_level", "region"])
        .agg(sales=("sales", "sum"),
             cost_amount=("cost_amount", "sum"),
             refund_amount=("refund_amount", "sum"))
        .reset_index())
cust["gross_profit"] = cust["sales"] - cust["cost_amount"]
cust["gross_margin"] = np.where(cust["sales"] > 0, cust["gross_profit"] / cust["sales"], 0)
cust["refund_rate"] = np.where(cust["sales"] > 0, cust["refund_amount"] / cust["sales"], 0)
cust = cust.sort_values("sales", ascending=False).head(10)

customer_records = [
    {
        "customer_id": r["customer_id"],
        "customer_name": r["customer_name"],
        "customer_level": r["customer_level"],
        "region": r["region"],
        "sales": round(float(r["sales"]), 2),
        "gross_profit": round(float(r["gross_profit"]), 2),
        "gross_margin": round(float(r["gross_margin"]), 4),
        "refund_rate": round(float(r["refund_rate"]), 4),
    }
    for _, r in cust.iterrows()
]

# =====================================================================
# 六、库存预警
# =====================================================================
inv = inventory.copy()
inv["product_name"] = inv["sku_id"].map(sku_name)
inv["sales_30d"] = to_num(inv["sales_30d"])
inv["current_stock"] = to_num(inv["current_stock"])
inv["turnover_days"] = np.where(
    inv["sales_30d"] > 0, inv["current_stock"] / (inv["sales_30d"] / 30), np.nan)

slow = inv[(inv["sales_30d"] == 0) & (inv["current_stock"] > 0)].copy()
slow = slow.sort_values("current_stock", ascending=False)
slow_records = [
    {
        "sku_id": r["sku_id"],
        "product_name": r["product_name"],
        "category": r["category"],
        "current_stock": int(r["current_stock"]),
        "sales_30d": int(r["sales_30d"]),
        "turnover_days": None,
    }
    for _, r in slow.iterrows()
]

turnover_top = inv[inv["sales_30d"] > 0].sort_values("turnover_days", ascending=False).head(10)
turnover_records = [
    {
        "sku_id": r["sku_id"],
        "product_name": r["product_name"],
        "category": r["category"],
        "current_stock": int(r["current_stock"]),
        "sales_30d": int(r["sales_30d"]),
        "turnover_days": round(float(r["turnover_days"]), 1),
    }
    for _, r in turnover_top.iterrows()
]

# =====================================================================
# 七、异常订单明细
# =====================================================================
o = orders.copy()
m_neg = o["gross_margin"] < 0
m_disc = o["discount"] > 0.30
m_ref = (o["sales"] > 0) & (o["refund_amount"] > o["sales"] * 0.5)
o["is_abnormal"] = m_neg | m_disc | m_ref

ab = o[o["is_abnormal"]].copy()

def build_reason(row):
    rs = []
    if row["gross_margin"] < 0:
        rs.append("负毛利")
    if row["discount"] > 0.30:
        rs.append("高折扣")
    if row["sales"] > 0 and row["refund_amount"] > row["sales"] * 0.5:
        rs.append("高退款")
    return "；".join(rs)

ab["abnormal_reason"] = ab.apply(build_reason, axis=1)
ab = ab.sort_values("sales", ascending=False)

abnormal_records = [
    {
        "order_id": r["order_id"],
        "order_date": r["order_date"].strftime("%Y-%m-%d"),
        "customer_name": r["customer_name"],
        "region": r["region"],
        "channel": r["channel"],
        "category": r["category"],
        "sales": round(float(r["sales"]), 2),
        "gross_margin": round(float(r["gross_margin"]), 4),
        "discount": round(float(r["discount"]), 2),
        "refund_rate": round(float(r["refund_rate"]), 4),
        "abnormal_reason": r["abnormal_reason"],
    }
    for _, r in ab.iterrows()
]

# =====================================================================
# 八、筛选联动底座：order_facts + targetFacts
# =====================================================================
facts_cols = ["order_id", "ym", "region", "channel", "category",
              "customer_id", "customer_name", "customer_level",
              "sales", "cost_amount", "refund_amount",
              "gross_margin", "discount", "refund_rate"]
facts = orders[facts_cols].copy()
for c in ["sales", "cost_amount", "refund_amount"]:
    facts[c] = facts[c].round(2)
for c in ["gross_margin", "refund_rate"]:
    facts[c] = facts[c].round(4)
facts["discount"] = facts["discount"].round(2)
facts_records = sanitize(facts.to_dict(orient="records"))

target_facts = [
    {"ym": r["month"], "region": r["region"], "target_sales": round(float(r["target_sales"]), 2)}
    for _, r in target.iterrows()
]

# =====================================================================
# 九、组装并写出
# =====================================================================
meta = {
    "title": "通用经营分析看板（模拟数据）",
    "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "date_range": [str(orders["ym"].min()), str(orders["ym"].max())],
    "regions": sorted(orders["region"].unique().tolist()),
    "channels": sorted(orders["channel"].unique().tolist()),
    "categories": sorted(orders["category"].unique().tolist()),
    "order_rows": int(len(orders)),
    "caliber": {
        "sales": "SUM(qty × unit_price × (1 - discount))",
        "gross_profit": "销售额 − SUM(qty × cost)",
        "gross_margin": "毛利 ÷ 销售额",
        "order_count": "COUNT(DISTINCT order_id)",
        "avg_order_value": "销售额 ÷ 订单数",
        "completion_rate": "实际销售额 ÷ 目标销售额（目标未拆渠道，筛选渠道时置空）",
        "refund_rate": "SUM(refund_amount) ÷ 销售额",
        "turnover_days": "当前库存 ÷ (近30天销量 ÷ 30)",
        "slow_moving": "近30天销量 = 0 且 当前库存 > 0",
        "abnormal": "毛利率 < 0 OR 折扣 > 30% OR refund_amount > 销售额 × 50%",
    },
}

dashboard = sanitize({
    "_meta": meta,
    "kpi": kpi,
    "trend": trend_records,
    "region": region_records,
    "category": category_records,
    "customerTop": customer_records,
    "inventoryWarning": {
        "slowMoving": slow_records,
        "turnoverTop": turnover_records,
    },
    "abnormalOrders": abnormal_records,
    "targetFacts": target_facts,
})

with open(WEB_DATA / "dashboard.json", "w", encoding="utf-8") as f:
    json.dump(dashboard, f, ensure_ascii=False, indent=2)

with open(WEB_DATA / "order_facts.json", "w", encoding="utf-8") as f:
    json.dump(facts_records, f, ensure_ascii=False, separators=(",", ":"))

# ---------- 校验打印 ----------
print(f"✅ dashboard.json   -> {WEB_DATA / 'dashboard.json'}")
print(f"✅ order_facts.json -> {WEB_DATA / 'order_facts.json'}")
print(f"   订单明细 facts：{len(facts_records)} 行")
print(f"   销售额：{kpi['sales']:,.2f}  订单数：{kpi['order_count']}  "
      f"客单价：{kpi['avg_order_value']:,.2f}")
print(f"   毛利率：{kpi['gross_margin']:.2%}  退款率：{kpi['refund_rate']:.2%}")
if kpi["completion_rate"] is not None:
    print(f"   销售完成率：{kpi['completion_rate']:.2%}")
print(f"   区域数：{len(region_records)}  品类数：{len(category_records)}  "
      f"客户 TOP：{len(customer_records)}")
print(f"   异常订单：{len(abnormal_records)} 行  "
      f"滞销 SKU：{len(slow_records)} 个  周转 TOP：{len(turnover_records)} 个")