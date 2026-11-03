# -*- coding: utf-8 -*-
"""
生成 dim_customer / dim_product / dim_region / target / inventory
依赖：先跑 generate_mock_data.py 产出 data/raw_orders.csv
"""
import random
from pathlib import Path
import pandas as pd
import numpy as np

random.seed(42)
np.random.seed(42)

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "data"

# ========== 1. dim_customer.csv ==========
# 30 个客户，区域固定，与结论“华东批发客户下滑”呼应
CUSTOMER_ROWS = [
    # id, name, level, region, start_date
    ("C001", "客户A", "战略", "华东", "2021-03-15"),
    ("C002", "客户B", "重点", "华南", "2022-06-01"),
    ("C003", "客户C", "战略", "华东", "2020-11-20"),
    ("C004", "客户D", "普通", "华北", "2023-01-10"),
    ("C005", "客户E", "重点", "华东", "2021-08-05"),
    ("C006", "客户F", "普通", "华南", "2022-09-18"),
    ("C007", "客户G", "普通", "西南", "2023-04-22"),
    ("C008", "客户H", "重点", "西南", "2021-12-01"),
    ("C009", "客户I", "普通", "华南", "2022-02-14"),
    ("C010", "客户J", "战略", "华北", "2020-05-09"),
    ("C011", "客户K", "普通", "华东", "2023-07-30"),
    ("C012", "客户L", "重点", "西南", "2021-10-11"),
    ("C013", "客户M", "普通", "华北", "2022-11-25"),
    ("C014", "客户N", "普通", "华南", "2023-03-03"),
    ("C015", "客户O", "重点", "华南", "2021-06-16"),
    ("C016", "客户P", "普通", "华东", "2023-08-08"),
    ("C017", "客户Q", "普通", "华北", "2022-04-19"),
    ("C018", "客户R", "战略", "西南", "2020-09-27"),
    ("C019", "客户S", "普通", "西南", "2023-05-12"),
    ("C020", "客户T", "普通", "华北", "2022-07-07"),
    ("C021", "客户U", "重点", "华北", "2021-01-21"),
    ("C022", "客户V", "普通", "华北", "2023-09-14"),
    ("C023", "客户W", "普通", "华南", "2022-12-30"),
    ("C024", "客户X", "重点", "华南", "2021-05-06"),
    ("C025", "客户Y", "普通", "华东", "2023-02-17"),
    ("C026", "客户Z", "普通", "西南", "2022-08-23"),
    ("C027", "客户AA", "战略", "华南", "2020-07-04"),
    ("C028", "客户AB", "普通", "华东", "2023-06-11"),
    ("C029", "客户AC", "重点", "华北", "2021-09-29"),
    ("C030", "客户AD", "普通", "西南", "2022-10-05"),
]
dim_customer = pd.DataFrame(CUSTOMER_ROWS, columns=[
    "customer_id", "customer_name", "customer_level", "region", "cooperation_start"])
dim_customer.to_csv(DATA / "dim_customer.csv", index=False, encoding="utf-8-sig")

# ========== 2. dim_product.csv ==========
PRODUCTS = {
    "手机配件": [("SKU001", "Type-C 快充线 1m", 45), ("SKU002", "20W 充电头", 88),
                ("SKU003", "无线充电板", 128), ("SKU004", "手机壳 通用款", 35),
                ("SKU005", "车载支架", 68)],
    "小家电":   [("SKU006", "电热水壶 1.7L", 158), ("SKU007", "空气炸锅 4L", 320),
                ("SKU008", "电动牙刷", 260), ("SKU009", "吹风机 1800W", 560),
                ("SKU010", "养生壶 1.5L", 180)],
    "数码":     [("SKU011", "蓝牙耳机 TWS", 3200), ("SKU012", "智能手表", 1580),
                ("SKU013", "移动电源 20000mAh", 199), ("SKU014", "平板电脑 10.5", 2480),
                ("SKU015", "机械键盘 87 键", 980)],
    "日用":     [("SKU016", "抽纸 3 层 24 包", 68.5), ("SKU017", "洗衣液 3kg", 45.6),
                ("SKU018", "垃圾袋 100 只", 22), ("SKU019", "湿巾 80 抽×3", 15.8),
                ("SKU020", "一次性手套 100 只", 12.5)],
}
product_rows = []
for cat, items in PRODUCTS.items():
    for sku_id, name, price in items:
        product_rows.append((sku_id, cat, name, price, round(price * 0.68, 2)))
dim_product = pd.DataFrame(product_rows, columns=[
    "sku_id", "category", "product_name", "unit_price_ref", "cost_ref"])
dim_product.to_csv(DATA / "dim_product.csv", index=False, encoding="utf-8-sig")

# ========== 3. dim_region.csv ==========
REGION_MAP = {
    "华南": (["广州", "深圳", "佛山", "东莞"], "林志远"),
    "华东": (["上海", "杭州", "南京", "苏州"], "沈国华"),
    "华北": (["北京", "天津", "石家庄", "太原"], "周建国"),
    "西南": (["成都", "重庆", "昆明", "贵阳"], "何晓峰"),
}
region_rows = []
for region, (cities, mgr) in REGION_MAP.items():
    for city in cities:
        region_rows.append((region, city, mgr))
dim_region = pd.DataFrame(region_rows, columns=["region", "city", "region_manager"])
dim_region.to_csv(DATA / "dim_region.csv", index=False, encoding="utf-8-sig")

# ========== 4. target.csv（读取订单实际值反推） ==========
orders = pd.read_csv(DATA / "raw_orders.csv", parse_dates=["order_date"])
orders["sales"] = orders["qty"] * orders["unit_price"] * (1 - orders["discount"])
orders["ym"] = orders["order_date"].dt.strftime("%Y-%m")

actual = orders.groupby(["ym", "region"])["sales"].sum().reset_index()
actual.columns = ["month", "region", "actual_sales"]

target_rows = []
for _, r in actual.iterrows():
    # 完成率在 72%–118% 之间随机，稳定可展示
    rate = random.uniform(0.72, 1.18)
    # 华东 2026-09 刻意压低完成率到 ~78%
    if r["month"] == "2026-09" and r["region"] == "华东":
        rate = 0.78
    target_rows.append((r["month"], r["region"], round(r["actual_sales"] / rate, 2)))

target = pd.DataFrame(target_rows, columns=["month", "region", "target_sales"])
target = target.sort_values(["month", "region"]).reset_index(drop=True)
target.to_csv(DATA / "target.csv", index=False, encoding="utf-8-sig")

# ========== 5. inventory.csv（近30天销量 = 10月销量） ==========
oct_sales = (orders[orders["ym"] == "2026-10"]
             .groupby("sku_id")["qty"].sum().to_dict())

inv_rows = []
for sku_id, cat, name, _, _ in product_rows:
    if sku_id in ("SKU019", "SKU020"):
        # 故意滞销：近30天销量=0，但仍有库存
        stock = 120 if sku_id == "SKU019" else 85
        inv_rows.append((sku_id, cat, stock, 0))
        continue
    sales_30d = int(oct_sales.get(sku_id, 0))
    if sales_30d == 0:
        sales_30d = random.randint(3, 10)   # 避免非目标 SKU 也滞销
    # 周转天数 = stock / (sales_30d/30)；让天数分布 10~150 天
    days = random.uniform(10, 150)
    stock = int(sales_30d / 30 * days)
    inv_rows.append((sku_id, cat, stock, sales_30d))

inventory = pd.DataFrame(inv_rows, columns=["sku_id", "category", "current_stock", "sales_30d"])
inventory.to_csv(DATA / "inventory.csv", index=False, encoding="utf-8-sig")

print("✅ dim_customer.csv      ", len(dim_customer))
print("✅ dim_product.csv       ", len(dim_product))
print("✅ dim_region.csv        ", len(dim_region))
print("✅ target.csv            ", len(target))
print("✅ inventory.csv         ", len(inventory))