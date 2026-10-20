from pathlib import Path
root = Path(__file__).resolve().parents[3]
p = root / '脚本' / 'verify_meal_ui.cjs'
s = p.read_text(encoding='utf-8')
s = s.replace("const uiSource = fs.readFileSync(path.join(__dirname, 'ryotei_meal_ui.js'), 'utf8');", "const uiSource = fs.readFileSync(path.join(__dirname, 'ryotei_meal_ui.js'), 'utf8');\nconst cardSource = fs.readFileSync(path.join(__dirname, 'ryotei_candidate_cards.js'), 'utf8');")
s = s.replace("classList: { toggle() {} },", "classList: { toggle() {} }, setAttribute() {},")
s = s.replace("  makeTable: (_columns, rows) => JSON.stringify(rows),", "  makeTable: (_columns, rows) => JSON.stringify(rows),\n  ryoteiTablePage: (_columns, rows) => ({rows,footer:''}),")
s = s.replace("domainSource + '\\n' + uiSource", "domainSource + '\\n' + cardSource + '\\n' + uiSource")
s = s.replace("当前剩余资金未知", "钱包未知").replace("已登记 1 单", "已记 1 单").replace("已登记 0 单", "已记 0 单").replace("本单前 -275 元", "余额 -275 元").replace("本单前 200 元", "余额 200 元").replace("本单前 100 元", "余额 100 元").replace("基础资金未知", "钱包未知")
s = s.replace("assert.equal(JSON.parse(node('#drinkrec-table-wrap').innerHTML).length, 46, '全部物品可达');", "assert.equal((node('#drinkrec-table-wrap').innerHTML.match(/data-candidate-kind=\\\"beverage\\\"/g)||[]).length, 46, '全部物品可达且不使用横向表格');\nassert.ok(!node('#drinkrec-table-wrap').innerHTML.includes('<table'), '候选不再用宽表格');")
p.write_text(s,encoding='utf-8')
print('COMPACT_TESTS_UPDATED')
