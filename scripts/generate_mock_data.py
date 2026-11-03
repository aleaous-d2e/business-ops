# -*- coding: utf-8 -*-
"""
生成模拟订单数据 raw_orders.csv
- 4200 行，覆盖 2026-01 ~ 2026-10
- 4 区域 / 4 品类 / 20 SKU / 30 客户 / 3 渠道 / 8 销售员
- 故意埋点：负毛利、折扣>30%、退款>销售额50%、10月滞销SKU(019/020)
"""
import csv
import random
from datetime import date
from pathlib import Path

random.seed(42)

OUT = Path(__file__).resolve().parent.parent / "data" / "raw_orders.csv"
OUT.parent.mkdir(parents=True, exist_ok=True)

N_ORDERS = 4200

REGIONS = {
    "华南": ["广州", "深圳", "佛山", "东莞"],
    "华东": ["上海", "杭州", "南京", "苏州"],
    "华北": ["北京", "天津", "石家庄", "太原"],
    "西南": ["成都", "重庆", "昆明", "贵阳"],
}
CHANNELS = ["批发", "线上", "门店"]
CATEGORIES = {
    "手机配件": (30, 300),
    "小家电": (100, 800),
    "数码": (200, 3000),
    "日用": (10, 100),
}

# 20 个 SKU：每品类 5 个
SKUS = []
for cat in CATEGORIES:
    for _ in range(5):
        SKUS.append({"sku_id": f"SKU{len(SKUS)+1:03d}", "category": cat})

# 30 个客户：客户A ~ 客户AD
LETTERS = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ") + ["AA", "AB", "AC", "AD"]
CUSTOMERS = []
for i, letter in enumerate(LETTERS):
    CUSTOMERS.append({
        "customer_id": f"C{i+1:03d}",
        "customer_name": f"客户{letter}",
        "region": random.choice(list(REGIONS.keys())),
    })

SALESPEOPLE = ["张伟", "李娜", "王强", "刘洋", "陈静", "赵磊", "孙敏", "周涛"]

# ---------- 按月份分配订单数 ----------
MONTHS = [(2026, m) for m in range(1, 11)]
raw = [random.randint(380, 460) for _ in range(10)]
scale = N_ORDERS / sum(raw)
month_counts = [round(x * scale) for x in raw]
month_counts[-1] += N_ORDERS - sum(month_counts)

rows = []
order_seq = 0

for (y, m), cnt in zip(MONTHS, month_counts):
    days_in_month = (date(y, m % 12 + 1, 1) - date(y, m, 1)).days if m != 12 \
                    else (date(y + 1, 1, 1) - date(y, 12, 1)).days
    for _ in range(cnt):
        order_seq += 1
        d = random.randint(1, days_in_month)
        order_date = date(y, m, d)
        cust = random.choice(CUSTOMERS)
        region = cust["region"]
        city = random.choice(REGIONS[region])
        channel = random.choice(CHANNELS)

        # 10 月排除 SKU019/020，制造“近30天0销量”的滞销 SKU
        if m == 10:
            sku = random.choice(SKUS[:18])
        else:
            sku = random.choice(SKUS)
        cat = sku["category"]

        lo, hi = CATEGORIES[cat]
        unit_price = round(random.uniform(lo, hi), 2)
        cost = round(unit_price * random.uniform(0.55, 0.82), 2)

        if channel == "批发":
            qty = random.randint(10, 100)
            discount = round(random.uniform(0.15, 0.30), 2)
        elif channel == "线上":
            qty = random.randint(1, 10)
            discount = round(random.uniform(0.05, 0.20), 2)
        else:
            qty = random.randint(1, 25)
            discount = round(random.uniform(0.05, 0.15), 2)

        sales = qty * unit_price * (1 - discount)
        refund = 0.0
        if random.random() < 0.10:          # 10% 正常小额退款
            refund = round(sales * random.uniform(0.01, 0.05), 2)

        rows.append({
            "order_id": f"ORD{y}{m:02d}{order_seq:06d}",
            "order_date": order_date.isoformat(),
            "customer_id": cust["customer_id"],
            "customer_name": cust["customer_name"],
            "region": region,
            "city": city,
            "channel": channel,
            "sku_id": sku["sku_id"],
            "category": cat,
            "qty": qty,
            "unit_price": f"{unit_price:.2f}",
            "discount": f"{discount:.2f}",
            "cost": f"{cost:.2f}",
            "refund_amount": f"{refund:.2f}",
            "salesperson": random.choice(SALESPEOPLE),
        })

# ---------- 埋异常 ----------
idx = list(range(len(rows)))
random.shuffle(idx)

# 20 条负毛利：成本 > 单价 × (1-折扣)
for i in idx[:20]:
    r = rows[i]
    price, disc = float(r["unit_price"]), float(r["discount"])
    r["cost"] = f"{price * (1 - disc) * random.uniform(1.05, 1.40):.2f}"

# 15 条折扣 > 30%
for i in idx[20:35]:
    rows[i]["discount"] = f"{random.uniform(0.31, 0.50):.2f}"

# 15 条退款 > 销售额 50%
for i in idx[35:50]:
    r = rows[i]
    sales = int(r["qty"]) * float(r["unit_price"]) * (1 - float(r["discount"]))
    r["refund_amount"] = f"{sales * random.uniform(0.55, 0.95):.2f}"

# ---------- 写出 CSV ----------
fields = ["order_id", "order_date", "customer_id", "customer_name", "region", "city",
          "channel", "sku_id", "category", "qty", "unit_price", "discount",
          "cost", "refund_amount", "salesperson"]

with open(OUT, "w", newline="", encoding="utf-8-sig") as f:
    writer = csv.DictWriter(f, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)

print(f"✅ 已生成 {len(rows)} 行 -> {OUT}")