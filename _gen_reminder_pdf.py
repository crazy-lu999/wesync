# -*- coding: utf-8 -*-
"""生成《待办到期提醒功能-上线任务清单》PDF"""
from fpdf import FPDF

FONT = r"C:\Windows\Fonts\simhei.ttf"
OUT = r"D:\26_code\shared-todo\wesync\截止提醒上线任务清单.pdf"

pdf = FPDF(format="A4")
pdf.set_auto_page_break(auto=True, margin=18)
pdf.add_font("Hei", "", FONT)

LEFT = 18
W = pdf.w - LEFT * 2

# —— 标题 ——
pdf.set_margin(LEFT)
pdf.add_page()
pdf.set_font("Hei", "", 20)
pdf.set_text_color(40, 40, 40)
pdf.set_xy(LEFT, 18)
pdf.multi_cell(W, 12, "待办到期提醒功能 · 上线任务清单", align="C")
pdf.set_font("Hei", "", 10.5)
pdf.set_text_color(120, 120, 120)
pdf.set_xy(LEFT, 34)
pdf.multi_cell(W, 6, "wesync 夫妻共享待办 · 代码已全部就绪，剩余均为平台操作 + 部署 + 测试", align="C")

y = 50
def heading(txt, color=(233, 98, 63)):
    global y
    pdf.set_xy(LEFT, y); pdf.set_font("Hei", "", 13); pdf.set_text_color(*color)
    pdf.cell(W, 9, txt, new_x="LMARGIN", new_y="NEXT")
    y = pdf.get_y() + 2
    pdf.set_draw_color(*color); pdf.set_line_width(0.6)
    pdf.line(LEFT, y - 1.5, LEFT + W, y - 1.5)

def item(main, sub=None):
    global y
    pdf.set_xy(LEFT, y); pdf.set_font("Hei", "", 10.5); pdf.set_text_color(30, 30, 30)
    pdf.multi_cell(W, 7, main, new_x="LMARGIN", new_y="NEXT")
    y = pdf.get_y()
    if sub:
        pdf.set_xy(LEFT + 10, y); pdf.set_font("Hei", "", 9.5); pdf.set_text_color(130, 130, 130)
        pdf.multi_cell(W - 10, 6, sub, new_x="LMARGIN", new_y="NEXT")
        y = pdf.get_y() + 3
    else:
        y += 3

heading("A. 平台侧（需登录后台，代码无法代劳）")
item("1. 申请订阅模板",
     "微信公众平台 → 小程序后台 → 功能 → 订阅消息 → 选用模板\n搜「待办提醒」类，选能装「待办内容 + 到期日期」的模板 → 提交审核")
item("2. 开启云函数 API 权限",
     "云开发控制台 → 云函数 → sendReminders → 配置 → API 调用权限 → 勾选 subscribeMessage.send")

heading("B. 填参（拿到模板后）")
item("3. 填 Template ID",
     "utils/config.js 的 REMIND_TMPL_ID ← 替换为审核通过的模板 ID\n把实际「字段码」发给开发，对齐 sendReminders 里 REMIND_FIELDS 的 thing2 / date3")

heading("C. 部署")
item("4. 部署 sendReminders",
     "右键云函数 →「上传并部署：云端安装依赖」（确认同步 config.json 定时触发器）")
item("5. 重部署 todoOps", "新增 reminded 字段逻辑生效")

heading("D. 真机验证")
item("6. 授权弹窗", "新建带「截止日期」的待办 → 自动弹订阅授权 → 点允许")
item("7. 手动补授权", "输入栏选日期后出现「早上提醒」小入口，可再点一次")
item("8. 定时发送", "设一个明天到期的待办，授权后，次日 8:00 后收到微信「订阅消息」推送")
item("9. 只提醒一次", "同一待办同一天不重复推送")
item("10. 指派生效", "指派给 A 的只 A 收到；「一起做」的两人都收到")

heading("[避坑] 关键注意事项", color=(200, 60, 40))
item("授权后 10 分钟才生效", "测试时别用「今天到期」，设明早或更远，等 ≥10 分钟再验")
item("一次性订阅", "一条待办用掉一条授权，用户可反复点「早上提醒」补授权")

pdf.output(OUT)
print("已生成:", OUT)