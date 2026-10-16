# 金融时序分析 Agent 预设使用说明

版本：1.0；设计日期：2026-10-16。

## 交付与定位

PRESET.md 是可直接粘贴的完整系统提示词，含规范术语、数据审计、模型选择、时间序列验证、两档可视化和输出自检。
ACCEPTANCE.md 是使用真实模型、数据文件和执行工具验证预设行为的案例集。

本次设计对象是分析 Agent 的行为规范。当前未提供金融数据，未训练模型、生成实盘结论或运行图表分析。提示词无法保证模型绝不产生幻觉，必须结合来源核验、代码执行、产物复核与验收案例控制问题。

本预设已注册到当前 DSH desktop profile 的原生 Agent 预设列表，界面名称为“金融时序数据分析师”，使用标准工具插件组合并注入本文件的完整金融时序分析规则。未安装额外依赖，也未修改已有插件。新建 Agent 或新会话时从预设列表选择；已经创建的 Agent 会保留原来的预设，不会自动切换。配置支持热加载，若列表没有立即更新，先刷新 DSH 界面再查看。

## 设计取舍

| 方案 | 适用情形 | 取舍 |
| --- | --- | --- |
| 完整通用预设 + 简短任务指令（本次采用） | 希望快速使用、可在不同宿主迁移 | 规则集中、便于审阅；每次加载占用一定上下文 |
| 精简主提示词 + 按需加载的方法和术语资料 | 大量重复分析，且宿主支持知识文件或技能 | 上下文较省；依赖宿主正确检索和加载资料 |
| 原生 Agent 配置与自动化流水线 | 需要一键运行、固定导出和批量任务 | 需先确定平台 schema、工具权限和运行环境，再单独实现 |

预设默认是单个 Agent，无需多 Agent 协作即可开展完整流程。随着实际任务增多，可把重复方法提取为经过验证的知识文件，无需预先构建复杂系统。

## 使用步骤

1. 新建 Agent 或新会话，在 Agent 预设列表选择“金融时序数据分析师”；无需手动复制 PRESET.md。
2. 让宿主提供本地文件读取、代码执行、表格解析、绘图和文件导出能力；若支持联网检索，可用于核实陌生术语、合约规则和外部事实。
3. 选择数据文件，提供本次任务指令。未知信息写“待确认”，不要为填写模板而猜测。
4. 检查审计报告、样本外比较、图表及源数据的一致性，尤其是信息时点与预测起点。

若宿主只允许聊天，不允许执行代码或导出文件，此预设只能协助设计流程和审阅，不能声称完成了实际计算。系统提示词也不会自动授予宿主本来没有的工具权限。

本地数据原则上在本地处理；联网检索仅传递必要的通用概念或公开信息，不能顺手上传原始表格。

## 首次任务指令示例

~~~text
老大，请按金融时序分析预设处理我提供的文件。

文件：我选择的黄金价格数据表。
分析目标：先审计数据并解释趋势、波动和异常，再判断现有数据是否足以开展预测。
标的/市场：待从文件说明或向我确认。
价格字段与计价单位：待确认。
时间字段、时区与每行代表的时段：待确认。
预测目标与期限：审计后给出建议，再确认。
图表档次：两档。
外部数据：默认只使用我提供的文件；确有需要先说明所需变量及用途。
输出：中文报告、结果表、两档图表、分析代码和运行记录。

先检查文件，不要根据文件名猜测单位，不要在没有运行时报告指标。
~~~

~~~text
老大，数据口径已经确认后，请预测未来 6 个交易小时的收盘价。
请明确区分：每个小时更新的一步预测，与当前时点一次预测未来 6 步。
以最新价格不变为基线，在相同预测起点比较少量合理候选。
采用滚动样本外评价，报告 MAE、RMSE 及可验证的预测区间。
图表给出简约档与学术档，并保存各图实际使用的数据。
~~~

第二段仅在数据确为可按交易小时解释的收盘价序列时使用。“6 个交易小时”与“未来 6 个自然小时”必须区分。

## 两档图表怎样选择

| 分析问题 | 简约档 | 学术档 |
| --- | --- | --- |
| 价格如何变化 | 价格折线，标注极值与样本范围 | 价格、收益和波动的关联面板，明确单位及样本口径 |
| 风险是否变大 | 滚动波动率与极端收益时点 | 波动代理、条件波动率及标准化残差诊断 |
| 哪个模型更可靠 | 模型与基线的样本外误差点图或柱状图 | 各滚动窗口与预测步长误差、稳定性及有依据的不确定性 |
| 预测范围有多大 | 实际值、预测线和经计算的预测区间 | 区间覆盖率、宽度、分步长表现及构造方法图注 |
| 是否有固定时段特征 | 可解释的星期/小时热力图 | 分组样本量、估计区间与多重比较说明 |
| 模型还有哪些缺陷 | 少量关键异常标记与解释 | 残差时间图、ACF、Q–Q 图及适用的检验结果 |

两档没有不同的事实标准：学术档增加诊断、方法披露与导出质量；简约档仍保留单位、来源、预测边界及必要限制。

默认配色建议为蓝色实际值、橙色模型预测、灰色基线及透明区间，配合线型区分。实际图表应根据曲线数量调整，不用红绿作为唯一区分。

## 推荐运行产物

~~~text
results/<本次运行编号>/
  report.md
  audit/                 数据字典、质量报告与清洗日志
  tables/                指标、窗口结果、预测结果、逐图数据
  figures/simple/        PNG，适合时增加 HTML
  figures/academic/      SVG 或 PDF，附 PNG 预览
  code/                  实际运行的分析脚本或笔记本
  manifest.json          输入哈希、实际版本、参数、时间口径、图表与数据关联
~~~

这是未来分析任务的建议输出结构，本次没有创建这些分析结果文件。交付多少图由问题与数据决定，不能把空缺数据拼成完整图集。

## 方法依据与核实来源

以下是预设设计时核实的第一方资料。核实日期统一为 2026-10-16；未来运行时，软件行为以实际安装版本及对应文档为准。下列链接是方法依据，不代表任何数据已经通过检验。

| 编号 | 来源 | 对应规则 |
| --- | --- | --- |
| S01 | scikit-learn：TimeSeriesSplit；https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html | 时间顺序切分、gap、等间隔及等时长比较的条件 |
| S02 | scikit-learn：Common pitfalls；https://scikit-learn.org/stable/common_pitfalls.html | 仅在训练集拟合预处理、特征选择及 Pipeline 的防泄漏用途 |
| S03 | statsmodels：Forecasting；https://www.statsmodels.org/stable/examples/notebooks/generated/statespace_forecasting.html | 预测步长、预测结果与滚动评价 |
| S04 | arch：Forecasting；https://arch.readthedocs.io/en/latest/univariate/forecasting.html | 条件方差预测、解析法、模拟法及自助法的适用条件 |
| S05 | scikit-learn：Lagged features for time series forecasting；https://scikit-learn.org/stable/auto_examples/applications/plot_time_series_lagged_features.html | 滞后特征、随机切分造成乐观误差和分位数预测 |
| S06 | statsmodels：ADF；https://www.statsmodels.org/stable/generated/statsmodels.tsa.stattools.adfuller.html | 单位根检验及回归项、滞后设定 |
| S07 | statsmodels：KPSS；https://www.statsmodels.org/stable/generated/statsmodels.tsa.stattools.kpss.html | 平稳性原假设及设定 |
| S08 | statsmodels：Ljung–Box；https://www.statsmodels.org/stable/generated/statsmodels.stats.diagnostic.acorr_ljungbox.html | 残差自相关检验及自由度设置 |
| S09 | scikit-learn：Model evaluation；https://scikit-learn.org/stable/modules/model_evaluation.html | 回归与分类评价指标及适用口径 |
| S10 | Nature：Preparing figures；https://research-figure-guide.nature.com/figures/preparing-figures-our-specifications/ | 坐标单位、可读性、色觉友好、字体编辑与栅格清晰度 |
| S11 | Nature：Formatting guide；https://www.nature.com/nature/for-authors/formatting-guide | 关联多面板、简明图注及 90/180 mm 版面参考 |

最终目标是让分析结果能被质疑、复核和复现。“学术风格”表示信息与版式严谨，不代表经过同行评审，也不等于预测更准确。
