---
title: "给 OpenClaw 做硬件没前途，但给上下文系统做，是值得的"
source: "https://mp.weixin.qq.com/s?__biz=Mzg5NTc0MjgwMw==&mid=2247523622&idx=1&sn=46b99f3559654165d91e2ceea9bbb4e5&poc_token=HJJA5Gmjy37m4B6L4ZvbXkbGnG-UWZgtJ6-oSKGC"
author:
  - "[[Founder Park]]"
published:
created: 2026-04-19
description: "所有的上下文，都是为了减少人和 AI 之间的摩擦。"
tags:
  - "clippings"
---
Founder Park *2026年4月2日 18:41*

![图片](https://mmbiz.qpic.cn/sz_mmbiz_gif/qpAK9iaV2O3sAVsSPfCN9UX44XiaoicbUJIrOGuaujdMNY6iaQewDZEX1GY3tcVk3QGeKJyUMMHBSMALvO8B7DZwsA/640?wx_fmt=gif&from=appmsg&tp=webp&wxfrom=5&wx_lazy=1#imgIndex=0)

一家叫泛灵人工智能的团队，出了一款主打「超级办公助理」的硬件产品。

参数配置很厉害，x86 芯片直接跑本地 Ubuntu，推理芯片可以本地跑 122B 的 MoE 模型 +27B 的稠密模型。支持办公场景的实时会议录音，操作任何设备的录屏，线下开会和外出调研的全记录。

目标是成为「口袋里的全模态超级办公助理」，后 OpenClaw 时代的个人 Agent Native 硬件基座。

初看到这个宣传，会有很多疑问，甚至质疑。

云端模型越来越强大、价格在持续下降的时候，把模型全放在端侧，有价值吗？122B 的模型到底能做啥？又做上下文记录又做任务处理，难道是想做 All in One 吗？

一个小团队，做这么复杂的硬件，今年 9 月份才量产，真的不是噱头吗？

所以今天这篇采访，更多的是好奇和 challenge 的角度，试图去理解他们为什么要用独立的硬件去作为上下文管理和路由系统，以及在他们看来，收集用户更多的 context，到底价值在哪里。

但很明显，不管是硬件还是软件，大家对于终点的设想看起来是一致的， **「构建用户的上下文中心，降低用户使用 AI 的门槛」** 。只是每个团队的解法不一样，比如我们之前采访的 Airjelly，用软件的形式，通过收集用户的 Enter 行为来确认用户的意图，降低人和 AI 的摩擦。

而泛灵的团队，选择了硬件这条很明显更难的一条路。

以下是 Founder Park 与泛灵人工智能 CEO Lotus、CPO Alfred 的对话，经编辑整理。

采访 | 万户

编辑 | 夏天

⬆️关注 Founder Park，最及时最干货的创业分享

---

超 22000 人的「AI 产品市集」社群！不错过每一款有价值的 AI 应用。

邀请从业者、开发人员和创业者，飞书扫码加群：

进群后，你有机会得到：

- 最新、最值得关注的 AI 新品资讯；
- 不定期赠送热门新品的邀请码、会员码；
- 最精准的 AI 产品曝光渠道

---

## 01

## 用 ToB 做产品验证，

## 用广告做 PMF 验证

**Founder Park：简单介绍一下你们的团队吧，大家是怎么聚在一起做这件事的？**

**Lotus：** 我们是比较典型的硬核工程加跨界产品的组合。创始团队有海外藤校背景的产品经理，索尼的影像工程师，大疆的渠道老兵，主导过多代旗舰手机营销的小米市场老将，CTO 是英伟达中国开发者最有价值专家。核心团队还有 MIT、苹果、微软、字节跳动等顶级公司和学校的同学，背景跨度很大。每个人都有做硬件的背景，大家聚在一起主要有两个原因：我们是连续创业团队，而且对技术演进方向有很多相同的非共识。

**Alfred：** 最早我和 Jay（COO）、Thomas（CTO）三个人合作做的第一个硬件，是给影像行业解决虚拟制片（用摄影机拍 LED 大屏）的问题。我们做的是解决虚拟制片中摄影机和 LED 屏同步、空间定位的专业硬件，叫 MagicCineTool。后来因为贸易战对 PCB 和电子元器件加征关税，这个产品流产了，大家才转型开始做 RM-01。

**Founder Park：ToB 产品 RM-01 是怎么来的，商业化跑通了吗？**

**Alfred：** 2023 年就开始了，比 DeepSeek 那波热度更早。一开始先做软件——基于 Qwen 1.5 的 110B 和 72B 做了一套软件，卖 20 万左右，但客户需要部署一两百万的服务器去做推理。那时候大家还没有「算力服务器」的概念，单位可能配个 NAS 或者传统服务器，这个账根本算不过来。

还有一个重要原因是我们当时做了一套公文写作系统，这类客户有严格的数据隐私需求，必须本地化部署和推理。那时候模型厂商都在做线上推理，但对数据隐私有要求又想用 AI 的客户，其实没人服务——这部分客户非常有价值。两个原因加在一起，我们决定做一个自己的硬件，把软件搭载上去作为整体解决方案交付，这就是 RM-01 的由来。

从 2023 年开始，到 2025 年 9 月完成 3C 认证，我们在内部对 RM-01 做了三代迭代：体积越做越小，加密鉴权改了很多遍，客户管理模型的方式从最早不能换模型，到后来通过 CFe 卡换模型并做非对称加密强绑定。DeepSeek 一体机火的时候我们压着没卖——团队有很多传统硬件大厂背景，做产品有一种惯性：一定要打磨到位了才推向市场，不会急于抢热度。

**Lotus：** 因为一开始做 RM-01 是从自己痛点出发，前几代刚出来的时候，周围合作过的开发者、集成商发现这个产品能解决痛点，POC 进展非常快，拿着半成品的机器就开始测了。第一批客户就是这些开发者，集成商，他们把整套软件加模型部署上去，以 DaaS（Device as a Solution）的方式卖给他们的客户。

从去年 10 月底正式销售到现在，大概有 200 多万的现金流。比如快餐连锁品牌把设备放在端侧做 AI 服务，前端接 AR 眼镜做员工培训，以前用人培训周期很长，现在用 AI 加 AR 缩短了很多。我们把服务交给更贴近客户的 ISV——他们更了解客户细节，我们专注把机器的稳定性和性能越做越好。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

RM-01 的实物图

**Founder Park：ToB 有了第一批客户和现金流，为什么转向 ToC？**

**Lotus：** ToB 有几个结构性问题。国内做 ToB 很多时候靠商务关系，发展上限有限；大客户 POC 周期动辄半年，还要满足各种合规性要求，整个链条非常长。我们内部也讨论过做定制化还是做标品的问题——定制化对创业团队来说很容易陷进去，所以我们给 ToB 产品的定义是「企业级消费产品」，买了就能用，这个思路后来也延续到了 ToC 产品上。

另一方面，我们团队最开始就想做 ToC，例如工业设计和制造标准从一开始就和 ToC 接轨。只是 2024 年受制于成本和技术成熟度，再加上消费侧需求不成熟，没有机会。到去年 9 月，成本控制、市场需求、技术成熟度同时到了一个节点，才做了战略转型：ToB 以惯性方式继续推进，未来主要做 ToC。

**Alfred：** 我们做产品的思路更像 IBM 或惠普那些旧叙事里做硬件的人——先做 ToB，把 ToB 作为 ToC 的验证和打磨阶段，一代一代在 ToB 上把技术成熟到可以下放到 ToC 的时候，才来做 ToC。

**Lotus：** 还有一个是客户侧的真实需求，是很多 ToB 客户一直在问：你们这个设备能不能做得更小？我当时就问自己，如果把产品做得非常小，变成真正便携式的计算设备，它能带来什么变化？这里面有个很重要的点是数据的获取方式。之前很大的机器很难做到随时采集、随时录制，必须依托门槛很高的企业级数据清洗和导入。但如果变得足够便携，从能够采集的数据源数量上就发生了根本变化——如果一个强算力设备足够便携，它就能以极低成本、极高隐私的方式连续获取用户各类上下文。

当使用本地算力把人的原始数据转化成足够多的面向 AI 的上下文之后，整个 AI 系统能产生非常多意想不到的价值。带着这个想法，我们才开始探索 ToC 方向。

**Founder Park：ToB 的用户画像是很明确，可是 ToC 似乎一开始没有明确的用户？**

**Lotus：** 最开始确实比较模糊。我们的 ToB 客户本身就不是典型大企业，很多是中小型企业、团队工作室、高校实验室。后来我们在面向投资人融资时发现他们也有这种需求——当时大家在聊 Plaud，聊小的录音设备，他们每天开很多会，都有上下文记录的问题。我说了 ToC 的想法之后，他们说想买一个试试。

我们在去年 12 月上线了面向海外市场的测试，在 FB 上投放了一些广告，把产品信息和功能特性都列上去，看具体是谁会对产品感兴趣。投放结束后画像比较明确了：科技大厂高管、SMB 小企业主、高级销售以及医生、律师、投资人。

用户反馈的核心需求是：Workflow Automation（任务自动化）、Personal Knowledge Base（个人知识库）、Local Inference（本地模型推理）。还有第四个——他们不愿意付 Token 的费用。我们就是基于这批真实数据，开始真正打磨 ToC 产品的方向。

## 02

## 用户不会为 Context 付费，

## 只会为结果付费

**Founder Park：C 端产品主要解决什么问题？**

**Lotus：** 我们对产品有两个定义：对外叫「全模态超级办公助理」，内部叫「超级节点」（Supernode）。它是一个计算平台，有强大的本地算力，能承载大模型和 Agent Runtime 环境，承载 Agent 的手和眼。它就像一个大的 Agent 网络中的一个节点，汇聚各种 Context。

目前主要做的场景是办公场景——录屏、线下会议录音，但这些都不是最终目的，因为他们都是收集 Context 的一种途径。我们对这些 Context 进行收集、处理、组织、计算，然后分发。这个节点其实是未来 A2A 网络中重要的一个入口， **核心目的之一是帮用户重构个人的上下文中心** 。

未来可以接入各种硬件生态——智能眼镜、智能手表、智能耳机、挂坠。像 Looki 前两天开放了 API 接口，我们可以做 Day One 适配，直接把 API 接进来。通过不断扩展感官，用户的 Context 中心会越来越完整。

**第二部分则是基于个人上下文，主动完成 Context 的路由并直接交付结果** 。这里最有价值的是帮助用户完成个性化的长尾任务，而所谓主动式，是指系统能在合适的场景和时间点预判用户需求，在用户发起指令之前先把任务做好。

我们观察到，白领和知识工作者日常使用终端设备，本质上是在执行各自的 SOP：获取原始数据，调用工具处理，再把结果放进下一个流程。每个人的 SOP 都不一样，背后体现的是个人偏好、行业经验、逻辑框架和方法论。我们的设备通过连续流式地观察用户行为，理解用户真实意图，把这些高频 SOP 无感沉淀成可复用的个人数字资产。

这里有两个关键。

第一是连续性，只有拉长时间线，才能看清一个用户的真实意图，或者说任务的边界：触发条件、执行管线；第二是无感，系统需要在不打扰用户的前提下，基于本地算力持续模拟、筛选并优化 SOP。随着用户上下文中心、经验证的个性化 SOP 和不断更新的热上下文一起积累，HippoGenius 就能主动完成越来越多个性化的长尾任务，比如提前搜集整理信息，按照用户喜好做 DCF 分析并生成财务模型，最后在用户周会前生成汇报文档并撰写好给上级的汇报邮件草稿待用户审核后发送，核心价值就是帮用户节省时间。

**Founder Park：但单纯的收集上下文今天是没价值的吧？**

**Lotus：** 对。我们做了非常多测试后发现，Context 本身没有直接价值——用户拿到很多 Context 之后是不知所措的，还要找工具、找模型来处理，最后才变成结果。 **用户不会愿意为 Context 付费，只会为结果付费** 。

但现在很多产品想给用户产出好结果却做不好，底层原因有两个：一是 Context 不够多，二是 Context 路由过程中试错太多导致费用爆炸。这两个问题的核心是：用户不应该为过程付费。线性交互中，用户 Context 匮乏，需要不断把脑海里的东西输入给模型，但用户不会为单独准备 Context 而付费。而 OpenClaw 这类产品会因为模型把多轮调用工具输出的结果放进上下文导致输入 Token 消耗巨大，也可能试错了、用错了工具，还得从头再来。

我们要把 Context 和人以及 AI 世界的链路打通。从多模态原始数据转化成文本 Context，我们有本地模型，不用花钱——Context 获取成本打到零。从文本 Context 到主动执行任务并交付结果，中间 Context 路由过程中的工具调用和试错，因为有本地算力，成本也是零。

举个例子，帮用户做任务自动化，我们可以同时模拟十几条甚至数十条通向最终结果的路径，基于用户 Context 做模拟，然后对结果进行排名，选出 Top 2 的结果给用户。其他结果直接扔掉，整个过程本身不用花钱。用户不会遇到「帮我做了几十次模拟，最后花了两千美金」的问题。

**Founder Park：所以单纯收集上下文是不够的，还需要连续地、实时地处理？**

**Alfred：** 对，一定要尽量实时处理，而且数据组织同样关键。否则用户一天产生的上下文会不断堆积，即使模型名义上有很长的上下文窗口，真正处理时也很容易出现中段信息被稀释、重点不清、检索效率下降的问题。

飞书录音豆推出后效果很好、抢占了一波 Plaud 用户，核心就在于实时转写——一个重要原因就在于它不是把整段长录音一次性丢给模型，而是先做实时转写，再按章节、主题和任务线索拆分处理，最后再做总结和归纳。这样模型拿到的不是原始数据，而是已经初步结构化过的信息，结果通常会更稳定。

对我们来说也一样，实时处理不只是把内容转成文字，更重要的是同步沉淀摘要、标签、待办和可检索结构，让一次录音或录屏最后不是停留在一份静态纪要上，而是变成后续还能继续调用、执行和演化的知识项目。

很多产品做不好，关键缺了数据组织这一环。写文章也好，做研报也好，模型能力其实都很强，写不好的原因一是数据来源不完整，二是数据组织不好——200-300 K 的上下文没有被整理成适合模型消费的结构，即便模型支持较长上下文，面对低质量、低结构化的信息堆积，效果往往也不会理想。

Manus 做研报效果好，很大程度上是因为它在上下文工程化上的完成度。它不只是「调用了模型」，而是把信息获取、信息清洗、任务拆解和执行链路做得比较扎实，比如用沙盒里的 Computer Use 去处理爬虫拿不到的信息、登录态和人机验证，对无法直接抓取的内容再通过截图和转写补足。这些本质上都是上下文的组织、补全和调度能力，而不只是模型能力本身。

**Founder Park：这么说飞书算不算你们的竞品？它也拥有大量用户上下文，也能在 APP 间串** **API** **。**

**Lotus：** 飞书是个非常好的例子。它是一个完整的生态，拥有大量用户 Context——会议录音、飞书文档、历史数据，各 APP 之间 API 互通，路由成本非常低。从产品体验上看，飞书跟我们做的事非常像。

但飞书是字节的垂类生态，做的事都跟飞书产品相关。我们做的是跨生态、跨平台的事。用户的工作不可能只在飞书上进行——很多时候在微信上，在钉钉上，在各种网页端的 APP 里。所以我们站在一个第三方的视角，从用户立场出发去处理这个问题。

**Alfred：** 哪怕飞书做了一样的事情，用户把所有生态接进飞书这件事依然耗时间且麻烦，且不说信任度问题。但如果一个小硬件任何时候只要插上就不用管了，摩擦是更低的。

我写了一个小软件来验证这个路径——把 iPhone 的静音键变成了 Action Button，一摁按钮就自动截屏用多模态模型去总结。长期使用下来发现真的很惊喜：一周以后模型给我推了三个点，其中一个是建议我关注闲鱼上 AI Max 395 价格的持续下跌。为什么？因为我这 7 天里看到了一些新的推理引擎和芯片演进方向，模型捕捉到了这些关联，建议我去看价格趋势来印证。原来如果用户能持续、无感地提供上下文，模型可以洞察到很多东西。

我们很多人发现不了上下文的价值，是因为没有一个很轻的交互方式让我们能连续地把上下文扔上去。

## 03

## 核心价值是减少人和 AI 之间的摩擦，

## 成为用户的 Time Saver

**Founder Park：作为新的消费电子产品，用户第一天能体会到什么价值？**

**Lotus：** 这是最关键的问题。如果没有 Day One Value，用户没法跨过消费心理门槛来购买。

第一天提供四个即时价值。第一，Onboard 时系统会请求获取本地工作文件只读权限和线上软件登录权限，授权后自动读取本地数据，同时时在 Ubuntu 沙盒内登录用户授权的 APP 并下载工作文档做向量化——第一天就能形成个人知识库。

第二，我们在设备中给用户提供的模型，Agentic 和 VL 能力已追平云端 Claude Sonnet 4.5，用户第一天就可以把设备当一台本地版 Manus 去用。同时设备搭载的自研记忆系统对用户上下文进行精确管理，在体验上超越 OpenClaw，而 OpenClaw 每月平均两三百美金 API 费用，再加上 Manus 基础版 40 美金，算 ROI 三个月就能回本。如果算上多模态数据压缩转化成 Context 的费用，只需要一周就能回本。

第三，通用型任务自动化。这是海外用户呼声最高的功能。比如聊天过程中提到下周要开个会，Agent 系统检测到这句话并转化为多步骤任务——预约会议、发送链接给参会人、基于会议主题和用户上下文生成会前 Todo List——加入排队队列，用户确认后立刻执行。飞书会把它变成一个 Todo，但 Todo 需要人去做；我们是把 Todo 变成机器可以做的事，用户只需要 Review。 **这是 Todo 和执行 Todo 之间的根本差别** 。

第四，8 个麦克风阵列，100 到 150 平方米办公环境内精确 3D 音源定位与切分，录音质量对标市面上 7-8 千元的录音设备，搭配强算力可做实时转写、转译和总结。

本质上，HippoGenius 是一个用户意图预测系统——结合构建好的用户上下文中心、沉淀下来的用户个性化 SOP 和不断采集的热上下文做预判。比如 7 点 59 分，系统已经知道用户每天 8 点要给老板发汇报邮件，会基于前天工作内容自动总结、按用户口吻写好草稿，并在收件人一栏填上老板的邮箱放在草稿箱。用户打开手机看到的是一个 Draft，Review 觉得 OK 就可以直接发。

预判系统把 Context 路由到合适的管线里执行合适的任务，极大减少了人和 AI 之间的摩擦。所以我们给 HippoGenius 的核心价值定位叫 Time Saver。

**Founder Park：那长期价值怎么体现？**

**Lotus：** 白领和知识工作者使用终端设备的本质就是在执行 SOP——获取原始数据，打开软件处理，得到结果，再放到下一个管线里。每个人的 SOP 不一样，体现的是他的偏好、行业经验和方法论。我们交付的是标品，但每个人的使用体验完全不同。

长期价值的核心是两点：无感沉淀和主动式交互。

连续性是个性化的基础——一个分析师花 20 分钟收集信息做研报，但只看这 20 分钟可能只能看到机械的信息收集。但如果看到前 20 分钟与老板沟通研报方向，以及后 30 分钟整理排版发送邮件，才能在更长时间轴上看清用户真实意图——帮老板处理任务并做汇报，或者说是用户 SOP 的边界：触发条件和执行管线。

无感则意味着用户不需要主动定义 SOP——机器在用户操作时进行连续观察学习，而在用户休息时同时模拟数十条可能令用户满意的执行管线，基于原始 Context 数据生成结果并做 Ranking，用户选择后基于反馈收敛。这是给 SOP 做强化学习，抹去试错成本，也极大降低了执行失败带来的失望感。我们内部叫它「SOP 竞技场」。

随着使用时间越来越久，三个核心组件不断成熟：已构建好的用户上下文中心、经过验证的个性化 SOP、源源不断新进来的热 Context。系统和用户的对齐率越来越高，机器就能主动完成越来越多个性化且长尾的高价值任务。

**Alfred：** 补充一个我们实际在用的场景。

做 ToB 市场时每天开好几场客户 POC 会议，之前会后要手动把客户反馈填进表格，可能两三个小时。现在把 HippoGenius 的开发板（样机）放在电脑旁边，开会时它能看到屏幕、听到声音。几场开完，它已经积累了所有 Context，直接登录内部飞书账号把反馈结果填进表格，并把表格发送给做售前的同事，只有客户后续跟进意见需要手动写。

就像一个助理一直跟在你身边——拿到最懂你的上下文，以最懂你的方式，实现你最想要的结果。

## 04

## 最好的上下文管理系统，

## 必须是独立硬件

**Founder Park：假设用户本身的设备算力够，电脑+软件是不是就够了？为什么还要单独的硬件？**

**Alfred：** 用户买 Mac 或 Windows 电脑，差不多还是 16-32GB 内存。除掉操作系统和常驻资源，能跑模型的内存最大不超过 20GB，最小可能是 6-7G。在这个体量上能用的全量模型最大到 9B 左右，而且量化过的模型——不管是用 MLX 跑还是 llama.cpp 的 GGUF 格式，4bit 量化后模型的整体 Loss 比较高。小模型本来效果就比较差。

更关键的是，这些小模型在做多模态理解时问题很大——它能准确转译用户目前录屏或截屏上的所有内容，但做不到用户注意力的感知。比如用户在某个页面停留了几秒，切到另一个页面又做了什么，这一个连续动作背后代表的用户含义，小模型理解不了。它只能做单帧画面理解或单个视频内容的转述。

这样的上下文放到记忆管理系统里，会产生很大问题——在模型看来，什么信息都有，但什么信息都没有。每个看起来都是重点，没有噪音，也就没有重点。模型的注意力一样会散落掉，无法提取用户真正干了什么。这是小模型最大的问题，也是我们这么努力把算力堆上去、把显存堆上去的原因。

**Lotus：** 我们内部做过测试。iPhone 17 Pro 是 3 纳米制程，上面跑模型大概跑个 4B 或 7B 已经是极限了。像之前豆包手机，本地 Agent 干的活就是做 GUI 点击操作，一些非常基础的工作。更复杂的任务或跑更大的模型则完全不可能。

电脑能力强一些，但也有限。我们测过 M3 Max 顶配版，40GB RAM，跑 Qwen 8B 的 VL 模型，温度迅速升到 80 到 90 度，待机时长从可能一天降到一个小时。跑起来之后打开飞书、Keynote 或浏览器开多个 Tab 就做不到了，基本只能做 AI 这一件事。用户变成了单线程——只能用模型或者只能办公，二选一。

所以一定会独立出来一台设备，专门帮用户把 AI 这件事干好，手机干手机的事，电脑干电脑的事，互相把最擅长的事做好。

**Founder Park：端云协同呢？本地小模型做 VL 处理，云端大模型分析意图？**

**Alfred：** 我们试过 4B 搭配 235B 的组合——235B 在那个时间节点上已经很不错了，但因为端侧输入质量太差，云端模型也很无能为力。

我们的上下文生成系统也不仅仅是直接放一个模型那么简单。在最前端入口，我们会有一个 YOLO 模型负责给不同的视频流打 Tag，然后把它路由到不同的处理管线上去。如果仅仅用一个模型硬跑，对模型能力要求比较高，所以我们的工程化方案是分层分级处理，在效能和成本之间找到最佳平衡。

**Lotus：** 软件方面也可以延伸讲一下。国内外很多软件都想做上下文统一和整理——国内像 Remio，最近很火的浏览器产品 Tabbit，还有字节开源的 MineContext，以及硅谷之前比较火的 Rewind。大家的愿景非常清楚，都想做这件事。

但软件需要依托用户的系统资源——算力、存储、电量。比如 Rewind 持续录制用户屏幕保存下来做 OCR，但把一段视频流直接扔给模型处理费用非常贵，同时为了保证隐私又不可能把用户整段视频流传到云端，所以只能做本地简单 OCR 和关键词检索回溯。还有的方案是做间歇式截屏——每隔十几秒截取屏幕，但上下文是碎片化的，没办法知道用户连续在做什么，也很难从碎片化的上下文中判断用户的真实意图。

在硬件资源限制和 Token 费用问题下，软件能发挥的上限是比较有限的。

## 05

## 更好的端云协同：

## 端侧持续产生高质量上下文，云端做指挥

**Founder Park：这个设备是全本地模型处理，还是也可以和云端模型协同？**

**Alfred：** 我们非常认同端云协同是未来的主流，而且这也是我们设备的主要使用方式。但端云协同不是简单地把模型分布在不同位置，而是端侧负责持续产生高质量上下文和执行，云端做任务结构化、规划和全局协同。

就像现在写代码时，用 Claude Opus 这样很强的模型做任务规划，再换成更小的模型去实际执行，效果依然很好。很大的模型几乎都是 MoE 架构，总参数量大、世界知识和任务覆盖面广，每次激活少量专家参与推理控制成本；而中小尺寸的稠密模型全参数参与推理，执行任务时边界更清晰、收敛性更高、推理路径更稳定。

端侧开源模型今年重点强化了 VL、OCR、Agentic 等能力——Browser Use、Computer Use——本质上都是环境感知和执行能力，像我们的五官和手，不是大脑。这些能力天然需要低时延、高频交互，端侧数据源离计算更近、处理链路更短、隐私链路更清晰、成本更低，是这些能力的第一落点。云端模型更多则承担着知识补全、任务拆解、群体协同。决定整个 AI 系统上限的，是模型架构、部署位置、任务拆解方式和调度策略的整体匹配，而不是某一种模型。

也就是说，我们会在 HippoGenius 上运行多种模型，包括但不限于 ASR、TTS、OCR、VL 等；针对不同的任务，使用不同的模型组合和路由策略。

**Founder Park：那什么任务是必须接云端模型的？**

**Alfred：** 可能最主要的场景是代码工作和重度逻辑推演工作。

**Founder Park：你们会把这款设备定义为 All-in-One 吗？**

**Lotus：** 我们的定义恰恰是 All-in-One 的反面——这个产品只做一件事： **构建用户的上下文中心，并主动把上下文路由到合适的工具，降低用户使用 AI 的门槛** 。它不是说你买了就可以告别云端大模型，而是你和 AI 之间的个人中枢和路由——因为它有你最好的上下文，不管是本地帮你处理还是找云端帮你处理，都可以从这里派发。

如果有一天市面上出现了「HippoGenius 是全能产品」这样的声音，恰恰说明连续上下文在各方面都发挥出价值了。但本质上我们只做一件事——降低人和 AI 之间的摩擦。

## 06

## A6 笔记本的形态+极轻便的「小尾巴」，

## 是现有工艺下的最优选择

**Founder Park：一个典型的用户使用场景大概是什么样的？**

**Lotus：** 用户通过一个 USB-C 小设备与 HippoGenius 交互，类似无线鼠标接收器，插在手机、电脑或平板上与主机无线配对。设计核心是让硬件「长在」用户设备上——底部 USB-C 接口支持充电和数据传输，24 小时无需取下，功耗仅 0.6 瓦，对手机电池几乎没有负担。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

**Alfred：** 可以把它理解为一个无线图传，把视频信号通过硬接口直接推流传到主机，不做压缩编码。线下时，传感器录到的音视频通过近场传输直接推流；离开主机时，数据暂存在手机 APP，有 WiFi 后通过 P2P 加密传回。

**Lotus：** 以白领为例——早上出门带手机就行。到了办公场景，按一下物理按钮开始录屏（也可同时触发录音）开始，以 Session 为单位有选择地记录，而不是 Always On。对于经常出差的商务人士，设备支持完全离线，在飞机上就是一个随时待命的本地 AI 助手，甚至可以在用户休息时自主完成任务。

**Founder Park：主机内部的芯片架构是怎样的？**

**Lotus：** 主机内部有三颗关键芯片。第一颗是 X86 SoC，运行完整的 Ubuntu 沙盒。第二颗是英伟达的推理芯片，专注推大模型，稳定 32 路并发，可同时服务 30 到 50 个 Sub-Agent。第三颗是 ESP32，负责加密鉴权，同时 X86 SoC 串口上显示为键盘和鼠标——这意味着它能操作所有 GUI 应用，第三方软件不会将其识别为 Bot，而是真实用户在操控。

**Alfred：** 现在大家还在大量使用 GUI，GUI Agent 不可避免，但 Agent 调用 CLI 更自然、更快、更收敛。ESP32 的键盘鼠标能力是在 CLI 无法覆盖时的补全，不是主路径。

**Founder Park：为什么是现在这样的造型？**

**Alfred：** 中间否决过两个方案。第一个是充电宝形态——好握持、亲和力强、侵入性低，但这是旧时代的产品形态，和我们想定义的全新产品概念不符。第二个是比 Plaud 厚一倍的卡片形态，像飞书录音豆底座那样——没有办法满足本地强算力的支撑，缺了这一环系统逻辑闭不了环，变成空中楼阁。

最终基于三个考量。一是工程化——三颗 SoC 的散热和供电需要基础体积。二是性能——没有做得更薄是考虑到麦克风腔体体积，大体积腔体能提供更好的音源定位和收音质量。三是场景适配——作为全新定义的产品不能对人的生活有过强侵入性，要符合商务场景的预期。所以做成 A6 笔记本大小。

外壳确定用铝合金——从铝材到表面处理供应链全链路管控，外观高级、传热能力强，可兼顾强制风冷和表面自然散热。RM-01 更像一本稍微厚一点的书立在那里，HippoGenius 从书的形态迁移成更薄的笔记本形态。核心能力是记录个人 Context、构建个人 Context 中心，再把 Context 路由到下一个工具，所以它更像一本人生笔记本。

配了一支可选配的磁吸笔配件，但不是写字用的，笔底端 4K 镜头、笔夹上缘 2K 镜头、顶部双麦克风、笔夹底端触发按钮。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

三个核心场景。第一是线下开会——不方便拿大设备甚至 Plaud 那样的卡片出来，笔在办公场景非常自然、非侵入式。第二是外出调研——手被占着的时候把笔夹到衣服口袋里，POV 视角，手势挥一下就能拍照。第三是随手笔记——按一下按键用底端 4K 镜头记录关键笔记、板书、场景。这支笔补全了线下除音频之外的多模态能力。

**Founder Park：设备续航怎么样？**

**Lotus：** 正常续航 8 到 10 小时，覆盖整个办公日。纯录音或信息采集可达 35 到 40 小时，待机 40 天。关键在于间歇性运行，不同的模型组合分批次处理任务，处理完即待机，小时平均功耗 6 瓦，峰值不超过 20 瓦。晚上放回底座充电，同时异步处理白天未完成的任务。

**Alfred：** 能耗管理分三档：节能模式延迟处理视频流，平衡模式对关键帧实时转写，高效模式完全实时。音频转录始终实时，因为 ASR 对 275 TOPS 算力几乎没有负担。每个任务类型都有独立的策略划分，三档只是用户侧的粗粒度控制。

**Founder Park：主机自带 5G 芯片吗？**

**Alfred：** 我们在考虑做 eSIM。因为前测中有真实用户反馈——高级销售和金融工作者经常需要外出工作，去客户现场销售或做金融审计，有随身携带的需求。这些场景下主机需要独立联网能力。

Lotus：联网方面，我们做了两层脱敏。第一层是多模态原始数据到文本 Context 的脱敏——上传一段录屏视频和上传一段模型对录屏信息的文本描述，敏感度完全不同。第二层基于标准规范加用户个人偏好，对 Context 二次脱敏。所有从设备发到网络的信息都经过两层脱敏后，已经不含任何跟用户直接相关的内容，只是一段结构化的功能性描述。云端模型处理后返回结果，再填回到需要的地方。

主机顶部有一个物理开关——像 iPhone 的静音键，左右可以推。推到一边允许接入网络，推到另一边完全离线运行。用户必须明确知道当前是断网还是联网状态。

我们还想在后期探索一个事——用摄像头、陀螺仪、人体存在传感器、近场毫米波雷达等各类传感器配合，把笔立在桌子上，在保证隐私的个人使用场景下，通过人物姿态、头部位置变化做辅助的注意力记录和判断，更好地做上下文过滤从提升记忆管理系统效率。

**Founder Park：用摄像头来做注意力感知吗？**

**Lotus：** 用户注意力就是一个过滤器，我们的 Context 很多很杂，如果像录屏软件那样同时录制多个屏幕包括后台，收集到的信息完全是散乱的。但如果以用户注意力为导向做 上下文加权，就能滤掉大量噪音。

**Alfred：** 比如用户在翻 PDF，但摄像头捕捉到眼神飘忽，我们就判断这个 PDF 不是当下最关心的内容，将其切片做成 RAG 塞入知识库，需要时再召回，而不是直接放进上下文。在连续时间轴上，注意力分布不均匀，捕捉到这个分布，才能给不同上下文赋予不同权重。目前我们采用的是一套软硬件结合的注意力算法去分析用户在连续时间线上的注意力分布。

这也是我们坚持做重硬件的核心原因——树莓派、RK3576 这类轻量方案完成不了。需要强算力中枢配合多传感器和多模态输入，少一环结果就会产生漂移。

**Founder Park：为什么叫 HippoGenius？**

Lotus：Hippocampus 是海马体——人类生成新记忆都要通过它。Genius 是天才。HippoGenius 就是你的「天才海马体」，帮你把那些原本会流失的记忆留住，慢慢地，它又会越来越懂你的习惯和节奏，在你需要的时候，主动把这些记忆变成提醒、总结，以及预判并帮你完成下一步的工作。

## 07

## 其他公司要做这个硬件，

## 至少需要一到两年

**Founder Park：HippoGenius 目前量产的核心难度在哪里？**

Alfred：最大的挑战是散热和供电——体积极大缩小后要保持原有性能。供电和电池占了大量体积，留给散热的空间非常狭小。难点不在于稳定导出热量，而在于推理芯片在推理过程中会突发热尖峰和电流尖峰，需要高比热容和电源分区来抹平。最终需要在散热和供电之间找到平衡点——根据用户更在乎续航还是推理效率来做取舍。

显存带宽方面，我们选用的颗粒带宽比较低，但影响不大——显存带宽不是推理速度的第一制约。英伟达 DGX Spark 发布后很多测评说推理慢是因为带宽低，但我们在更低带宽的 Jetson Orin 上推得比它还快，背后是大量算子优化。存储用 eMMC 就够了，因为所有数据都是转写后的文本、字符串和 Token，对传输带宽要求很低。

**Founder Park：你们做这件事的壁垒在哪里？**

**Alfred：** 硬件壁垒确实比较高。我们选的这颗芯片是 SM87 的平台，它并不是为今天这类大参数 LLM 推理场景专门设计的芯片。虽然 NVIDIA 提供了 JetPack、TensorRT、cuDNN 等官方推理栈，但不少面向数据中心的新算子、推理框架和高性能 kernel 支持并不完整，也几乎没有优化。围绕这些关键链路，我们做了大量移植、编译和性能优化，把大模型推理相关的关键算子、运行时和工程链路都优化到可交付水平。相关工作也已经开源。

开源的核心是控制产品路径——我们发布什么，其他厂家就用什么。当时的算子移植高度依赖特定版本的工具链、推理框架和大量工程化 patch。随着上游库持续迭代，原来的依赖组合已经很难完整复现；如果没有保留完整的环境快照和补丁链路，即使是原团队，今天要低成本原样重做一遍也未必容易。

Qwen 3.5 发布后，我们也测试过 vLLM、SGLang 这类通用推理框架。在我们的目标设备和目标负载下，它们的表现还不够理想。原因不只是模型本身，还包括边缘侧芯片上的框架开销、内存占用和 kernel 适配深度。针对这些问题，我们做了一个更轻量的自研 C++ Runner。在指定模型、全/半精度和最大上下文长度下，它在延迟和吞吐上比通用框架快了近一倍，同时运行时开销也更低。此外，我们完成了对新一代 Blackwell 的兼容和优化，对设备树、BSP/系统层和推理引擎做了大量自研定制。

此外，我们是国内第一个把这款推理芯片上板的推理硬件厂商，所以产品才能做这么薄。标准的方案通常是以模组形态通过板对板连接器接入载板。我们的方案不是 Module-on-Board，而是 Chip-on-Board 设计，把核心 SoC 及其配套高速与供电系统直接做进主板。这省掉了模组和连接器堆叠，对整机厚度、结构集成和散热路径优化都有帮助，但也显著提高了高速布线、供电、EMI/EMC 和量产验证的工程门槛。这类方案的难点不在于把板子点亮，而在于把性能、厚度、散热和量产可靠性同时做平衡，因此后来者的追赶周期通常会比较长。

**Founder Park：那如果是大厂呢？**

**Lotus：** 手机和电脑厂商从生态位上就不太适合做这件事。这些厂商既要承载软件生态，又要服务终端用户。把底层数据打通做 Agent 入口技术上不难，但一旦这么做，就从底层逻辑上侵犯了生态合作伙伴的利益——软件不用点 GUI 了，用户不用看广告了，硬件厂商和生态厂商的关系会急剧恶化。

而且用户对手机和电脑的期待已经很高了。大家是既要又要的状态——做了 AI 其他事还要做。怎么可能保证手机正常运行的情况下，还运行一个强大的 AI 系统帮你本地完成所有事？这非常难。

所以我们认为一定会出现一个第三方的强算力本地设备。而且从硬件限制来看，手机电池撑不起实时上下文收集，电脑的既要又要也很难满足。

## 08

## 硬件只是商业化的第一步，

## 核心是成为人和 AI 世界之间的中枢

**Founder Park：你们的设备明显是本地跑 OpenClaw 的绝佳设备，为什么不打这个点的定位？**

**Lotus：** OpenClaw 是非常好的产品，让普通消费者用上了有记忆管理系统、能主动执行任务的 Agent 系统。但它目前比较偏 MVP——记忆管理系统用 MD 文件直接管理，实际测试下来对上下文压力非常大，Token 费用很难控制。我们把 OpenClaw 搭载在 ToB 设备上做过技术验证，确实能跑，但从 Demo 到商业化交付，中间还有大量工程化落地的问题要解决，比如安全性和记忆组织架构。

如果宣传「我们是本地的 OpenClaw」，就是在拉高用户预期。OpenClaw 执行任务链条很长，中间某个环节失败了可能直接弹错误让用户接管，体验会非常 frustrated。我们因为能做本地模拟，可以在很大程度上先把失败消化掉，用户看到的只是一个好结果——这是云端很难实现的，有本地算力的产品天生擅长干这个事。不如我们自己做一次完整迭代，从记忆架构到管线管理全部升级，真正做出让用户觉得「哇，真的很好用」的产品体验。

**Founder Park：商业化路径怎么考虑？**

**Lotus：** 端云协同是大方向，端侧是入门基础，云端是价值延伸的战略要地。商业化有四个方向。

第一是 API Router 服务，我们充当端云协同的中转角色，用户买 Credit 使用云端模型，当然所有请求会经过两层脱敏后再上传。

第二是数据服务，基础层是云端备份，更深层是模型蒸馏——用户积累了大量个人数据和 SOP 后，通过线上模型蒸馏固化到模型中，OTA 传回本地做更新。

第三是 SOP 社区。设备内部能沉淀大量用户个性化 SOP，我们想构建一个有网络效应的产品——随着人群和 SOP 越来越多，新、老用户的设备附加值都越来越高。

第四是多人协作——这是最有想象空间的。比如一个投资团队，每人拥有一台 HippoGenius，一起做某个项目时在云端开一个 Workspace，它拥有整个团队每个人开放了权限的 Context 的总和，所有 Agent 预先交换信息，拉齐进度，Workspace 里的 Agent 团队自动规划和执行任务，人唯一需要介入的场景就是补充关键信息和在关键节点做决策。

这在未来会形成一种新的团队协作范式——人作为一个团队，Agent 分身们作为一个团队，线上线下协同办公，大幅度提升协作办公的效率。人作为信息输入源提供补充信息，作为决策者提供关键决策，大量的工作由线上 Agent 团队来完成。Workspace 本身就可以以席位为单位，进行管理和收费。

这四个方向背后有一个更大的范式转移。之前从互联网成长起来的企业是以注意力经济为核心的——抢夺用户注意力，投放广告。 **但 GUI 消失的浪潮已经起来了，Agent 开始用 CLI 交互，一定会有一个从注意力经济转向 A2A 经济的过程。** 广告的投放会汇集到下一个信息集成和分发平台上去，而我们给自己的定义就是人和 AI 世界之间的中枢。当然这还是个畅想，需要谨慎处理用户信任问题。

**Founder Park：你们怎么判断个人 Agent 未来的终局形态？**

**Lotus：** 未来个人 Agent 的终局可能是无处不在的流动形态——它代表的是你的数字分身，不会被禁锢在固定的实体里。当它控制空调和家里的电器时，这些电器就是个人 Agent 的化身；帮你操作软件、剪辑视频时，软件本身就是 Agent 的化身。

但在抵达终局之前，人类必须跨越一个鸿沟——让 AI 与人达到极高比例的对齐。对齐的唯一前提是以低成本、高隐私、高同步率、高带宽获取用户的全量 Context。它不是一蹴而就的，而是从构建 Context 开始，慢慢数字化、慢慢同步，对齐率越来越高，在某个临界点发生质变，进入 Agent 时代。未来 Agent 一定不是一个单独的硬件，而是一个全局的、无处不在的形态。

**Founder Park：如果最后没成，你们觉得可能是因为什么？**

**Lotus：** 底层技术演进发生逆转——比如 A2A 方向突然停滞。更本质地说，是信息传播的速度和方式发生了逆转。A2A 带来的最大价值就是信息传播方式变了、速度变快了，接入 A2A 之后人已经明显跟不上那个速度了。除非这种传播方式和速度发生逆转，否则这个进程一定会发生。

**Alfred：** 从硬件角度，需要同时满足两个条件，独立硬件才可能不再被需要。

第一，电池取得重大突破，电池能量密度大幅进步——目前电池技术没有特别大的突破，手机撑不起实时视频流的捕捉和转写。

第二，芯片制程再次获得突破——从端侧芯片来讲，苹果看得最远、走得最快、能耗比做得最好。

如果同时满足，那就不需要独立硬件了。但我们判断短期内不会发生。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

**更多阅读**

[字节出来的 00 后团队，做了一款主动式 AI 桌面助手：只记录意图，想「预测你的下一步」](https://mp.weixin.qq.com/s?__biz=Mzg5NTc0MjgwMw==&mid=2247523552&idx=1&sn=b1eb1ee5c8976e47b7e3e7b7628e13a4&scene=21#wechat_redirect)

## 拿下 Kickstarter 只是 AI 硬件出海的第一步，线下渠道才是终局

[OpenClaw 闭门局：和 30 位创业者一起聊聊，真正值得关注的 Agent 生态位在哪？](https://mp.weixin.qq.com/s?__biz=Mzg5NTc0MjgwMw==&mid=2247523427&idx=1&sn=dbf618ec7e136f6a1d2f1f161ef86ca0&scene=21#wechat_redirect)

[提示词工程、上下文工程都过时了，现在是 Harness Engineering 的时代](https://mp.weixin.qq.com/s?__biz=Mzg5NTc0MjgwMw==&mid=2247523279&idx=1&sn=ee25366cb30dc002c12e1f000affd91f&poc_token=HBS9t2mjl_7-DtqMMqr6U9PPXSqI9YU2K7e0tTz3&scene=21#wechat_redirect)

转载原创文章请添加微信：founderparker

继续滑动看下一个

Founder Park

向上滑动看下一个

![kimi](data:image/png;base64,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)