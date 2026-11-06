# -*- coding: utf-8 -*-
"""把 data-new/*.tsv 合并进 index.html 的 DISHES_RAW，并做严格校验。"""
import re, pathlib, sys

ROOT = pathlib.Path(r"C:\Users\暴龙\Documents\deepseek-harness\default-workspace\情侣电子菜单")
HTML = ROOT / "index.html"
NEW = ROOT / "data-new"

# 期望分配
PLAN = {
    "前菜": (101, 108), "早餐": (109, 116), "拿手菜": (117, 136), "锅物": (137, 142),
    "汤": (143, 150), "主食": (151, 162), "小吃": (163, 172), "甜品": (173, 180),
    "饮品": (181, 188), "夜宵": (189, 200),
}
TAGS = {"", "招牌", "微辣", "甜", "隆重", "特调"}
LVS = {"简单", "中等", "进阶"}

errors = []
rows_all = []

existing_names = set(re.findall(r"name: '([^']+)'", HTML.read_text(encoding="utf-8")))
# 只保留 DISHES_RAW 里的名字（settings 默认菜单等不会命中 name: ' 前缀，够用）

for cat, (a, b) in PLAN.items():
    f = NEW / f"{cat}.tsv"
    if not f.exists():
        errors.append(f"[缺失] {cat}.tsv 不存在")
        continue
    text = f.read_text(encoding="utf-8").strip("\ufeff").strip()
    lines = [l for l in text.splitlines() if l.strip()]
    want = b - a + 1
    if len(lines) != want:
        errors.append(f"[行数] {cat}: 期望 {want} 行，实际 {len(lines)} 行")
    for i, line in enumerate(lines):
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != 12:
            errors.append(f"[字段数] {cat} 第{i+1}行: {len(parts)} 段 -> {line[:60]}")
            continue
        did, c, emoji, name, desc, price, tag, t, lv, ing, steps, tip = parts
        expect_id = f"d{a+i}"
        if did != expect_id:
            errors.append(f"[id] {cat} 第{i+1}行: 期望 {expect_id}，实际 {did}")
        if c != cat:
            errors.append(f"[分类] {did}: {c} != {cat}")
        if not emoji:
            errors.append(f"[emoji] {did} 为空")
        if not (2 <= len(name) <= 8):
            errors.append(f"[菜名长度] {did}: {name} ({len(name)})")
        if name in existing_names or any(r["name"] == name for r in rows_all):
            errors.append(f"[重名] {did}: {name}")
        if len(desc) > 14 or any(ch in desc for ch in "|、；"):
            errors.append(f"[desc] {did}: {desc}")
        if not re.fullmatch(r"\d+", price) or not (6 <= int(price) <= 68):
            errors.append(f"[价格] {did}: {price}")
        if tag not in TAGS:
            errors.append(f"[tag] {did}: {tag}")
        if not re.fullmatch(r"\d+", t) or not (3 <= int(t) <= 120):
            errors.append(f"[时长] {did}: {t}")
        if lv not in LVS:
            errors.append(f"[难度] {did}: {lv}")
        ing_list = [x for x in ing.split("、") if x.strip()]
        if not (4 <= len(ing_list) <= 8):
            errors.append(f"[食材] {did}: {len(ing_list)} 样 -> {ing}")
        step_list = [x for x in steps.split("；") if x.strip()]
        if not (3 <= len(step_list) <= 5):
            errors.append(f"[步骤] {did}: {len(step_list)} 步 -> {steps[:40]}")
        if len(tip) > 24 or any(ch in tip for ch in "|、；"):
            errors.append(f"[tip] {did}: {tip}")
        rows_all.append(dict(id=did, cat=cat, emoji=emoji, name=name, desc=desc, price=int(price),
                             tag=tag, t=int(t), lv=lv, ing=ing, steps=steps, tip=tip))

print(f"读到 {len(rows_all)} 条 / 目标 100 条，问题 {len(errors)} 个")
for e in errors[:60]:
    print(" -", e)

if "--check-only" in sys.argv:
    sys.exit(1 if errors else 0)

if errors:
    print("\n有错误，未写入。修好后重跑。")
    sys.exit(1)

def q(s):
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"

lines = []
for r in rows_all:
    lines.append(
        "    { id: %s, cat: %s, emoji: %s, name: %s, desc: %s, price: %d, tag: %s, r: { t: %d, lv: %s, ing: %s, steps: %s, tip: %s } },"
        % (q(r["id"]), q(r["cat"]), q(r["emoji"]), q(r["name"]), q(r["desc"]), r["price"], q(r["tag"]),
           r["t"], q(r["lv"]), q(r["ing"]), q(r["steps"]), q(r["tip"]))
    )

src = HTML.read_text(encoding="utf-8")
m = re.search(r"(  const DISHES_RAW = \[.*?)(\n  \];)", src, re.S)
assert m, "DISHES_RAW not found"
src = src[:m.start()] + m.group(1) + "\n" + "\n".join(lines) + m.group(2) + src[m.end():]
src = src.replace("const MENU_VERSION = 4;", "const MENU_VERSION = 5;")
src = src.replace("// 100 道菜：每道带做法", "// 200 道菜：每道带做法")
HTML.write_text(src, encoding="utf-8")
print("写入完成，菜品条数:", src.count("{ id: 'd}"), "bytes:", len(src.encode('utf-8')))
