---
title: "用初中数学理解LLM工作原理"
source: "https://mp.weixin.qq.com/s/erdNQYejO-ynvsBbnkDX6g"
author:
published:
created: 2026-04-11
description:
tags:
  - "clippings"
---
*2024年12月19日 00:01*

点击上方“ **图灵人工智能** ”，选择“星标”公众号

您想知道的人工智能干货，第一时间送达

![图片](https://mmbiz.qpic.cn/sz_mmbiz_jpg/4ibmFwuCSRFwEDP7SEibqWn6GYfIPDnxTcUQZ6z5MlEv9rljdsPK8Px0manf0utVLbSy4krR8bypOSYwSvp5IbmA/640?wx_fmt=other&wxfrom=5&wx_lazy=1&wx_co=1&tp=webp#imgIndex=0)

本文将从基础开始讨论大语言模型（LLM）的工作原理——假设你只知道如何对两个数字进行加法和乘法。  
  
首先，作者Rohit Patel会从构建一个简单的生成式人工智能出发，逐步阐释理解现代LLM和Transformer架构所需的所有知识。本文将剔除机器学习中所有花哨语言和术语，将一切简单地表示为数字。  
  
（本文作者Rohit Patel是Meta的数据科学家。本文由OneFlow编译发布，转载请联系授权。原文：https://towardsdatascience.com/understanding-llms-from-scratch-using-middle-school-math-e602d27ec876）

**作者** **| Rohit Patel****  
翻译｜张雪聃、** **林心宇、刘乾裕**

**OneFlow编译**

**本文主要内容：**

1\. 一个简单的神经网络

2\. 这些模型是如何训练的？

3\. 这一切是如何生成语言的？

4\. 是什么使得LLM如此有效？

5\. 嵌入

6\. 子词分词器

7\. 自注意力

8\. Softmax

9\. 残差连接

10\. 层归一化

11\. Dropout

12\. 多头注意力

13\. 位置信息嵌入

14\. GPT架构

15\. Transformer架构

**1**

**一个简单的神经网络**

首先，需要注意的是，神经网络只能接受数字作为输入，并只能输出数字，毫无例外。关键在于如何将输入以数字的形式表示，并以实现目标所需的方式解释输出的数字。

然后，构建神经网络，使其能够接收你提供的输入并给出你想要的输出（基于你选择的输出解释）。让我们看看如何从加法和乘法走向像Llama 3.1(*https://ai.meta.com/blog/meta-llama-3-1/*)这样的模型。

**我们构建一个 **用于对物体进行分类的** 简单神经网络：**

- **可用的物体数据** ：颜色（RGB）和体积（毫升）
- **分类为** ：叶子或花

以下是叶子和向日葵的数据示例：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

现在，我们构建一个神经网络来进行分类。我们需要确定输入和输出的物理意义。我们的输入已经是数字，因此可以直接输入到网络中。我们的输出是两个物体，叶子和花，神经网络无法直接输出。我们可以考虑几种方案：  
  

- 我们可以让网络输出一个数字。如果这个数字是正数，我们就说它是叶子；如果是负数，我们就说它是花。
- 或者，我们可以让网络输出两个数字。我们将第一个数字解释为叶子的数字，第二个数字解释为花的数字，然后选择较大数字对应的物体作为分类结果。

这两种方案都允许网络输出数字，我们可以将其解释为叶子或花。我们在这里选择第二种方案，因为它在我们后面要看的其他任务中也适用。以下是使用该方案进行分类的神经网络。我们来分析一下：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

蓝色圆圈的计算方式如下：（32 \* 0.10）+（107 \* -0.29）+（56 \* -0.07）+（11.2 \* 0.46）= -26.6

术语：

***神经元/节点*** ：圆圈中的数字

***权重*** ：线条上的彩色数字

***层*** ：一组神经元称为一层。可以认为该网络有3层：输入层有4个神经元，中间层有3个神经元，输出层有2个神经元。

要计算该网络的预测/输出（即“ **前向传播** ”），需从最左侧开始，在输入层中有原始的数据，要“向前”移动到下一个层，需要将上一层特定神经元圆圈中的数字与下一层配对神经元连边上的权重相乘，然后将汇聚到同一个神经元的所有连边产生的乘积加和。在上面的例子中，我们演示了蓝色圆圈的计算。运行整个网络，我们发现输出层的第一个数字更高，因此我们将其解释为“网络将这些（RGB，Vol）值分类为叶子”。经过良好训练的网络可以接受各种（RGB，Vol）的输入，并正确分类物体。

模型并不知道什么是叶子或花，或（RGB，Vol）是什么。它的任务是接收确切的4个数字并输出确切的2个数字。我们将这4个输入数字解释为（RGB，Vol），同时查看输出数字并推断如果第一个数字更大则为叶子，反之则为花。当然，我们需要选择合适的连边权重，以便模型能够接收我们的输入数字并给出正确的两个数字，使得我们解释时能得到想要的结果。

一个有趣的副作用是，对上面这个网络，不是输入RGB和体积，而是输入其他4个数字，如云层覆盖、湿度等，并将两个数字解释为“一个小时内晴天”或“一个小时内下雨”，如果将权重校准良好，便可以让同一个网络同时完成两项任务——分类叶子/花和预测一个小时内的降雨！网络只给出两个数字，无论将其解释为分类、预测还是其他东西，都完全取决于你。

为简化起见而省略的内容（可忽略，不影响理解）：

- **激活层** ：该网络中缺少一个关键的东西，即“激活层”。这是一个花哨的词，可以对每个圆圈中的数字施加非线性变换（ **RELU** 是一种常见的激活函数，只需将负数设置为零，正数保持不变）。因此在我们上面的例子中，我们会将中间层的两个数字（-26.6和-47.1）替换为零，然后再继续到下一层。当然，我们必须重新训练权重，使网络再次有效。没有激活层，网络中的所有加法和乘法都可以压缩成一个等价的单层网络（注：连续的矩阵乘等的结果还是一个矩阵）。在我们的例子中，你可以直接将绿色圆圈写成RGB的加权和，而不需要中间层。它的形式为（0.10 \* -0.17 + 0.12 \* 0.39–0.36 \* 0.1）\* R + （-0.29 \* -0.17–0.05 \* 0.39–0.21 \* 0.1）\* G ……依此类推。如果我们在其中引入非线性，多层网络就不能用一个等价的单层网络来简化了。这有助于网络处理更复杂的情况。
- **偏置** ：网络通常还会包含与每个节点相关的另一个数字，该数字简单地加到计算节点值时的乘积上，这个数字称为“偏置”。因此，如果顶层蓝色节点的偏置为0.25，则节点中的值为：（32 \* 0.10）+（107 \* -0.29）+（56 \* -0.07）+（11.2 \* 0.46）+ 0.25 = -26.35。术语“参数”用来指代权重和偏置，也就是模型中所有不属于神经元/节点的数字。
- **Softmax** ：我们通常不会直接将输出层解释为模型所示的样子。我们将这些数字转换为概率（即，使所有数字为正数并相加为1）。如果输出层中的所有数字已经是正数，可以通过将每个数字除以输出层中所有数字的和来实现。然而，通常使用“softmax”函数可以处理正数和负数。

**2**

**这些模型是如何训练的？**

在上面的例子中，我们神奇地得到了能够将数据输入模型并得到良好输出的权重。那么，这些权重是如何确定的呢？设置这些权重（或“参数”）的过程称为“ **训练模型** ”，我们需要一些训练数据来训练模型。

假设我们有一些数据，已知每个输入对应的是叶子或花，这就是我们的“ **训练数据** ”，由于我们为每组（R,G,B,Vol）数字提供了叶子/花的标签，这就是“ **标注数据** ”。

具体过程如下：

- 从随机数开始，即将每个参数/权重设置为随机数。
- 现在，我们给了一个对应于叶子的输入（R=32, G=107, B=56, Vol=11.2），我们希望输出层中叶子的数值更大。我们设想叶子对应的数值为0.8，花对应的数值为0.2（如上例所示，但这些是示范性的数字，实际上我们不想要0.8和0.2。在现实中，这些应为概率，实际上并非如此，我们希望它们为1和0）。
- 我们知道想要的输出层数值，以及从随机选择的参数得到的数值（这些与我们想要的不同）。因此，对于输出层中的所有神经元，我们计算想要的数值与实际数值之间的差值，然后将所有差值相加。例如，如果输出层的两个神经元为0.6和0.4，那么我们得到：(0.8–0.6)=0.2和(0.2–0.4)= -0.2，总共为0.4（忽略负号再相加）。我们可以称之为“ **损失** ”。理想情况下，我们希望损失接近于零，即希望“ **最小化损失** ”。
- 一旦有了损失，我们可以轻微调整每个参数，以查看增加或减小它是否会增加或减小损失（称为移动权重）。这称为该参数的“ **梯度** ”。然后我们可以将每个参数按小幅度移动到损失降低的方向（梯度的方向）。一旦所有参数都轻微移动，损失应该会降低。
- 不断重复这个过程，将减少损失，最终得到一组“ **训练** ”好的权重/参数。这个过程被称为“ **梯度下降** ”。

几点注意事项:

- 通常会有多个训练样本，因此在一个样本中微调权重以最小化损失可能会导致另一个样本的损失变得更糟。处理这种情况的方法是将损失定义为所有样本的平均损失，然后对该平均损失进行梯度计算。这会减少整个训练数据集的平均损失。每个这样的周期称为一个“ **epoch** ”。然后，可以不断重复这些周期，从而找到能够减少平均损失的权重。
- 我们实际上并不需要“移动权重”来计算每个权重的梯度——我们可以直接从公式推断出。例如，如果在最后一步权重为0.17，且神经元的值为正，我们希望输出更大的数字，我们可以看到将该数字增加到0.18会有所帮助。

在实践中，训练深度网络是一个困难且复杂的过程，因为梯度在训练期间可能会失控，变为零或无穷大（这称为“梯度消失”和“梯度爆炸”问题）。我们在这里讨论的损失的简单定义是完全有效的，但实际上很少使用，因为有更好的功能形式适合特定目的。随着现代模型包含数十亿个参数，训练一个模型需要大量计算资源，这也带来了自身的问题（内存限制、并行化等）。

**3**

**这一切是如何帮助生成语言的？**

请记住，神经网络接受一些数字，根据训练的参数进行一些数学运算，并输出其他数字。一切都与解释和训练参数（即将其设置为某些数字）有关。如果我们可以将这两个数字解释为“叶子/花”或“一小时后是雨还是晴”，我们也可以将其解释为“句子中的下一个字符”。

但英语字母不止两个，因此我们必须扩展输出层中的神经元数量，例如到英语字母表中的26个字母（我们还可以加入一些符号，如空格、句号等）。每个神经元可以对应一个字符，我们查看输出层中的（大约26个）神经元，表示输出层中数值最高的神经元标号对应的字符就是输出字符。现在我们有了一个可以接受某些输入并输出一个字符的网络。

如果我们将网络中的输入替换为这些字符：“Humpty Dumpt”，并要求它输出一个字符，并将其解释为“网络对我们刚输入的序列下一个字符的建议”。我们可能会将权重设置得足够好，以使其输出“y”——从而完成“Humpty Dumpty”。现在还有一个问题未解决，我们如何将这些字符列表输入到网络中？我们的网络只接受数字！！

一个简单的解决方案是为每个字符分配一个数字代号。假设a=1，b=2，依此类推。现在我们可以输入“humpty dumpt”，并训练它给我们“y”。我们的网络如下图所示：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

现在我们可以通过提供字符列表来预测一个字符。我们可以利用这一事实构建一个完整的句子。例如，一旦我们预测出“y”，我们可以将“y”附加到现有字符列表中，并喂给网络，请求预测下一个字符。如果训练得当，它应该给出一个空格，以此类推。最终，我们应该能够递归生成“Humpty Dumpty sat on a wall”。我们有了生成式AI。此外， ***我们现在拥有一个能够生成语言的网络！*** 当然，实际上没有人会随意输入分配的数字，我们将看到更合理的方案。

聪明的读者会注意到，由于图示的方式，我们无法将“Humpty Dumpty”直接输入网络，因为它的输入层只有12个神经元，每个神经元对应“humpty dumpt”中的一个字符（包括空格）。那么我们如何在下一次传递中输入“y”呢？在那里放置一个第13个神经元需要修改整个网络，这并不现实。解决方案很简单，让我们去掉“h”，发送12个最近的字符。因此，我们将发送“umpty dumpty”，网络将预测出一个空格。接着我们将输入“mpty dumpty”，它会产生一个“s”，依此类推。如下图所示：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

在最后一行中，我们仅将“sat on the wal”喂给模型，丢失了很多信息。那么，今天最新最强大的网络如何处理呢？或多或少也是如此。我们可以输入到网络的长度是固定的（由输入层的大小决定）。这称为“上下文长度”——为网络提供的上下文，以进行未来的预测。现代网络可以具有非常大的上下文长度（几千个单词），这非常有帮助。有一些方法可以输入无限长度的序列，但这些方法的性能虽然优异，但已经被其他具有大型（但固定）上下文长度的模型超越。

仔细的读者会注意到，对于相同的字母，我们对输入和输出有不同的解释！例如，在输入“h”时，我们仅用数字8来表示，但在输出层时，我们并不是要求模型输出一个单一的数字（“h”的8， “i”的9，依此类推），而是要求模型输出26个数字，然后我们查看哪个数字最大，如果第8个数字最大，我们将输出解释为“h”。为什么我们不在两端使用相同且一致的解释呢？我们可以，实际上，在语言的情况下，选择不同解释方式的自由给你提供了更好的机会，来构建更好的模型。恰好，目前已知的对输入和输出的最有效解释也是不同的。事实上，我们在此模型中输入数字的方式并不是最好的，我们将很快看到更好的方法。

**4**

**大语言模型为什么能如此有效？**

逐字符生成“Humpty Dumpty sat on a wall”与现代大语言模型的能力相去甚远。我们从上述简单的生成式AI到人类般的聊天机器人的过程中，有许多差异和创新。我们将逐一讨论这些内容。

**5**

**嵌入**

我们之前讨论过，目前将字符输入模型的方式并不是最佳选择，因为我们为每个字符任意选择了一个数字。假设我们可以为这些字符分配更合理的数字，就能更好地训练网络。如何找到这些更优的数字呢？这里有一个巧妙的思路：

在训练之前的模型时，我们的做法是调整权重，以减少最终的损失。每一次迭代，我们都会：

- 输入数据
- 计算输出层
- 将输出与理想结果进行比较，计算平均损失
- 调整权重，然后重新开始

在这个过程中，输入是固定的。对于（RGB, Vol）这样的输入，这种方法是合理的。然而，现在我们为“a”、“b”、“c”等字符选择的数字是任意的。那么，在每一次迭代中，除了调整权重，我们还可以尝试改变输入的表示方式，看看是否能通过使用不同的数字来表示“a”等字符，从而降低损失。这种方法确实能够提高模型的性能（因为我们有意地调整了“a”的输入方向）。基本上，我们不仅对权重进行梯度下降，也对输入的数值表示进行调整，因为这些数字本身是任意选定的。这就是“ **嵌入** ”的概念，它是将输入映射到数字的一种方式，并且需要进行训练。训练嵌入的过程与训练参数类似，但有一个主要优势是，一旦训练完成，你可以在其他模型中复用这个嵌入。此外，请记住：始终使用相同的嵌入来表示一个特定的符号/字符/单词。

我们之前讨论了将字符表示为单个数字的嵌入。然而，实际上，嵌入通常包含多个数字。这是因为用单一数字来捕捉概念的丰富性是很困难的。以叶子和花朵的例子为例，我们为每个物体分配了四个数字（即输入层的大小）。这四个数字传达了不同的属性，使模型能够有效地识别物体。如果我们只用一个数字，比如颜色的红色通道，模型可能就会面临更大的挑战。我们在这里试图表示人类语言，因此需要用到多个数字。

那么，既然我们不能只用一个数字来表示每个字符，是否可以用多个数字来捕捉这种丰富性呢？我们可以为每个字符分配一组数字，称为“向量”（向量是有序的数字集合，每个数字都有特定的位置，交换两个数字的位置会得到不同的向量。以叶子和花朵的数据为例，若将叶子的红色和绿色数字交换，就会得到不同的颜色，因此不再是同一个向量）。向量的长度就是它包含的数字数量。我们将为每个字符分配一个向量。这里有两个问题：

- 如果我们为每个字符分配了一个向量，而不是单个数字，我们该如何将“humpty dumpt”输入网络呢？答案很简单。假设我们为每个字符分配了一个包含10个数字的向量。那么，输入层就不再是12个神经元，而是120个神经元，因为“humpty dumpt”中的12个字符每个都有10个数字输入。我们只需将这些神经元依次排列，就可以正常工作。
- 那么我们如何找到这些向量呢？幸运的是，我们刚刚学习了如何训练嵌入数字。训练嵌入向量的过程与此并无不同。尽管现在有120个输入，而不是12个，但你所做的只是移动它们，以查看如何最小化损失。然后你可以取出这120个输入中的前10个，作为字符“h”的对应向量，依此类推。

当然，所有的嵌入向量必须具有相同的长度，否则我们就无法将所有字符组合稳定地输入网络。例如，在“humpty dumpt”和下一次迭代的“umpty dumpty”中，两个例子都包含12个字符，如果每个字符不是用长度为10的向量表示，我们就无法将它们稳妥地输入一个长为120的输入层。下图是这些嵌入向量的图示：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

我们可以将同一长度的向量集合称为矩阵。上述矩阵称为“ **嵌入矩阵（embedding matrix）** ”。你可以通过提供对应字母的列号，查看矩阵中的对应列，从而获得用于表示该字母的向量。这一方法可以更普遍地应用于嵌入任何任意集合的事物，只需确保矩阵的列数与要嵌入的事物数量相同即可。

**6**

**子词分词器**

目前为止，我们一直将字符作为语言的基本构建块，但这有其局限性。神经网络的权重需要处理大量的工作，理解特定字符序列（即单词）之间的关系。如果我们直接为单词分配嵌入，并让网络预测下一个单词会怎样呢？反正网络只理解数字，所以我们可以为单词“humpty”、“dumpty”、“sat”、“on”等分配一个长度为10的向量，然后输入两个单词，让它预测下一个单词。“ **词元** **（token）** ”指的是我们嵌入并输入到模型中的单一单位。我们之前的模型使用字符作为词元，现在我们提议使用整个单词作为词元（当然，你也可以选择使用整个句子或短语作为词元）。

使用单词分词对我们的模型有一个深远的影响。英语中有超过18万个单词。根据我们之前的输出解释方案，每个可能的输出都需要一个神经元，因此输出层需要数十万个神经元，而不仅仅26个。虽然现代网络所需的隐藏层规模使这个问题不那么突出，但值得注意的是，由于我们将每个单词视为独立的单元，并且从随机的嵌入数字开始——非常相似的单词（如“cat”和“cats”）在一开始没有任何关系。我们希望这两个单词的嵌入相互接近，模型无疑会学习到这一点。但是，我们能否利用这种显而易见的相似性来简化问题呢？

答案是肯定的。当前语言模型中最常见的嵌入方案是将单词分解为子词，然后进行嵌入。以“cats”为例，我们可以将其拆分为两个词元：“cat”和“s”。这样一来，模型更容易理解“s”与其他类似单词的关系。这也减少了我们需要的词元数量（例如，sentencepiece（ (https://github.com/google/sentencepiece) ）是一个常用的分词器，其词汇量选项从数万到数十万不等，而英语中单词的数量往往高达数十万）。分词器的功能是将输入文本（如“Humpty Dumpty”）分解为词元，并给出对应的数字，以便在嵌入矩阵中查找该词元的嵌入向量。例如，在“humpty dumpty”的情况下，如果我们使用字符级分词器，并按照上面的嵌入矩阵排列，那么分词器会首先将“humpty dumpty”拆分为字符\['h', 'u', …, 't'\]，然后返回数字\[8, 21, …, 20\]，因为你需要查找嵌入矩阵的第8列来获取'h'的嵌入向量（嵌入向量是你输入到模型中的内容，而不是数字8，与之前不同）。矩阵中列的排列完全无关紧要，只要每次输入'h'时查找相同的向量就可以。分词器主要的任务就是将句子拆分为词元。

结合嵌入和子词分词，一个模型可能看起来像这样：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

接下来的几个部分将讨论语言建模中的最新进展，以及这些进展使LLM变得如此强大的原因。然而，为了理解这些内容，你需要掌握一些基本的数学概念。以下是这些概念：

- 矩阵和矩阵乘法
- 数学中函数的一般概念
- 数字的幂运算（例如，a³ = a \* a \* a）
- 样本均值、方差和标准差

我在附录中添加了这些概念的总结。

**7**

**自注意力机制**

到目前为止，我们只看到了一个简单的神经网络结构（称为前馈网络），该结构包含多个层，每一层都与下一层完全连接（即，连续层之间的每两个神经元都有连接），并且仅与下一层相连（例如，层1与层3之间没有连接）。然而，实际上我们可以随意移除或增加其他连接，甚至构建更复杂的结构。接下来，让我们探讨一个特别重要的结构：自注意力机制。

如果我们观察人类语言的结构，会发现想要预测的下一个单词往往会依赖于之前的所有单词。然而，某些单词可能比其他单词对这个预测的影响更大。例如，在句子“Damian had a secret child, a girl, and he had written in his will that all his belongings, along with the magical orb, will belong to \_\_\_\_”中，这个空白处的单词可能是“her”或“him”，而其具体依赖于句子中较早出现的一个单词：girl/boy。

好消息是，我们的简单前馈模型能够连接上下文中的所有单词，因此它可以学习重要单词的适当权重。但是问题在于，前馈层中连接特定位置的权重是固定的（对于每个位置都是如此）。如果重要的单词总是处于同一位置，模型能够适当地学习权重，那我们就没问题了。然而，下一个预测所需的相关单词可能出现在系统中的任何位置。我们可以重述上面的句子，当猜测“her”还是“him”时，无论该单词在句子中出现在哪里，“boy/girl”都是一个非常重要的预测线索。因此，我们需要的权重不仅依赖于位置，还依赖于该位置的内容。我们如何实现这一点呢？

自注意力机制的做法是对所有单词的嵌入向量进行加权求和，但不是直接相加，而是对每个向量应用一些权重。如果“humpty”、“dumpty”和“sat”的嵌入向量分别为x1、x2、x3，则输出将是一个加权和，例如：输出=0.5 x1+0.25 x2+0.25 x3，其中输出即为自注意力的结果。如果我们将权重表示为u1、u2、u3，则输出=u1x1+u2x2+u3x3。我们如何找到这些权重u1、u2、u3呢？

理想情况下，我们希望这些权重依赖于我们正在加和的向量——正如我们所看到的，其中一些向量可能比其他的更为重要。但重要性取决于谁？取决于我们即将预测的单词。因此，我们希望权重不仅依赖于我们要加和的单词，还依赖于我们即将预测的单词。问题在于，在预测之前，我们当然不知道这个单词是什么。因此，自注意力机制使用了我们要预测的单词前面的单词，即可用句子的最后一个单词（我不太清楚为什么选择这样，但在深度学习中，很多事情都是经过不断尝试与摸索的，这种方式的效果似乎颇为良好）。

我们想要这些向量的权重，并希望每个权重依赖于我们要聚合的单词和即将预测的单词前面的单词。从根本上来说，我们想要一个函数u1=F(x1, x3)，其中x1是我们要加权的单词，x3是我们当前序列中的最后一个单词（假设我们只有3个单词）。实现这一目标的一种直接方法是为x1（我们称之为k1）构建一个向量，为x3（我们称之为q3）构建另一个向量，然后计算它们的点积。这样我们就得到一个依赖于x1和x3的数值。我们如何获取这些向量k1和q3呢？我们构建一个小型单层神经网络，将x1映射到k1（或者将x2映射到k2、x3映射到k3，依此类推）。然后我们构建另一个网络，将x3映射到q3等等……使用矩阵表示法，我们基本上得出权重矩阵Wk和Wq，使得k1=Wkx1，q3=Wqx3。现在我们可以计算k1和q3的点积，以得到一个标量，因此u1=F(x1, x3)=Wkx1·Wqx3。

自注意力机制中的另一个补充是，我们不会直接对嵌入向量本身进行加权求和，而是对该嵌入向量的某种“值”进行加权求和，这个“值”通过另一个小型单层网络获得。这意味着，与k1和q1类似，我们现在也会为单词x1获得一个v1，并通过矩阵Wv使得v1=Wvx1。这个v1随后被聚合。因此，如果我们只有3个单词并且试图预测第四个单词，整个过程看起来像这样：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

加号表示向量的简单相加，暗示它们必须具有相同的长度。最后一个未显示的修改是，标量u1、u2、u3等并不一定加起来等于1。如果我们希望它们成为权重，就必须让它们相加为1。因此，我们在这里使用一个熟悉的技巧，即softmax函数。

这就是自注意力机制。此外，还有交叉注意力机制，在这种机制中，q3可以来自最后一个单词，但k和v可以来自另一句话。这在翻译任务中非常有价值。现在我们知道了注意力机制的概念。

这一切现在可以被打包成一个称为“自注意力块”的结构。基本上，这个自注意力块接收嵌入向量并输出一个用户选择的长度的单一输出向量。这个块有三个参数：Wk、Wq、Wv——无需更加复杂。在机器学习文献中，有许多这样的块，通常在图示中以盒子的形式表示，标注上它们的名称。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

在自注意力机制中，你会发现到目前为止词元的位置似乎并不重要。我们在各处使用相同的W，因此交换“Humpty”和“Dumpty”并不会产生真正的差异——所有数字最终都会相同。这意味着，虽然注意力机制可以确定关注的内容，但这不会依赖于单词的位置。然而，我们知道在英语中，单词的位置很重要，因此我们可以通过让模型了解单词的位置来提高性能。

因此，在使用注意力机制时，我们通常不会直接将嵌入向量输入自注意力块。我们将稍后看到如何在输入到注意力块之前，为嵌入向量添加“位置编码”。

对于那些不是第一次阅读自注意力机制的人来说，可能会注意到我们没有引用任何K和Q矩阵，或应用掩码等。这是因为这些细节是实现方式的一部分，源于这些模型的常见训练方式。一批数据被输入，模型同时训练以从“humpty”预测“dumpty”，从“humpty dumpty”预测“sat”，等等。这是为了提高效率，并不影响解释或模型输出，我们选择在这里省略这些训练效率的技巧。

**8**

**Softmax**

我们在最初的笔记中简要提到Softmax。Softmax试图解决的问题是：在输出解释中，我们的神经元数量等于网络要选择的选项数量。我们说过，网络的选择可以解释为值最高的神经元。然而，理想的目标值是什么呢？在叶子/花朵的例子中，我们将其设置为0.8，但为什么是0.8？为什么不设为5、10或1000呢？理想情况下，我们希望得到无穷大！但这会使问题变得不可处理——所有的损失都会变为无穷大，而我们通过调整参数（记得“梯度下降”吗？）来最小化损失的计划就会失败。我们该如何解决这个问题？

有一种简单的方法：限制我们想要的值。假设我们将其限定在0到1之间？这样会使所有的损失都是有限的，但现在我们又面临网络过度预测的问题。例如，假设在某一情况下它的输出为(5,1)，而在另一情况下输出为(0,1)。第一种情况虽然选择正确，但损失却更大！因此，我们需要一种方法将最后一层的输出转换到(0,1)范围内，同时保持顺序性。我们可以使用任何函数（在数学中，函数是将一个数字映射到另一个数字的规则）来完成这个任务。一个可行的选择是逻辑函数（见下图），它将所有数字映射到(0,1)之间，并保持顺序性：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

现在，我们为最后一层的每个神经元都得到了一个介于0和1之间的数字，我们可以通过将正确的神经元设为1，其他神经元设为0，来计算损失。这确实可行，但我们能做得更好吗？

回到我们的“Humpty Dumpty”例子，假设我们试图逐字符生成“dumpty”，而我们的模型在预测“m”时犯了错误。它并没有将“m”作为最高值，而是将“u”视为最高值，虽然“m”也紧随其后。

现在我们可以继续使用“duu”并尝试预测下一个字符等等，但由于从“humpty duu..”开始没有那么多好的后续内容，模型的置信度会很低。另一方面，“m”是紧随其后的选择，所以我们也可以试试“m”，预测接下来的几个字符，看看会发生什么？也许它会给我们一个在整体上更适合的单词？

这里我们讨论的不是盲目选择最大值，而是尝试几个可能的选项。如何做到这一点呢？我们得给每个选项赋予一个概率，比如第一个选项有50%的概率，第二个选项有25%的概率，依此类推。这是一个不错的做法。但也许我们希望这些机会依赖于模型的预测。如果模型预测的“m”和“u”的值非常接近，那么以接近50%对50%的概率去探索这两个选项或许是个好主意。

因此，我们需要一个良好的规则，将所有这些数字转换为概率。这正是Softmax所做的。Softmax是上述逻辑函数的一种泛化，但具备额外的特性。如果你给它10个任意的数字，它将返回10个输出，每个输出在0和1之间，且这10个输出的总和为1，这样我们就可以将它们解释为概率。你会发现，Softmax几乎是每一个语言模型最后一层的常见选择。

**9**

**残差连接**

随着我们对网络的理解不断深入，我们对网络的可视化呈现也在逐渐发生变化。现在我们使用框/块来表示某些概念，这种表示法在标记残差连接这一有用概念时尤为有效。让我们来看一下残差连接与自注意力块结合的示意图：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

注意，我们将“输入”和“输出”标记为框，以简化说明，但这根本上仍然是神经元/数字的集合，和之前的示意图类似。

这里发生了什么？我们实际上是在自注意力块的输出上加上原始输入，然后再将结果传递给下一个块。首先要注意的是，残差连接要求自注意力块的输出维度与输入的维度相同。这不是什么大问题，因为正如我们所提到的，自注意力的输出是由用户决定的。但这样做的目的是什么呢？这里我们不详细探讨，但关键在于，随着网络层数的增加（输入与输出之间的层数），训练网络变得越来越困难。残差连接已被证明有助于应对这些训练挑战。

**10**

**层归一化**

层归一化是一个相对简单的层，它会对进入层的数据进行归一化处理，即减去均值并除以标准差（可能还会有一些其他处理，如下所示）。例如，如果我们在输入之后立即应用层归一化，它会计算输入层中所有神经元的均值和标准差。假设均值为M，标准差为S，那么层归一化的过程是将每个神经元的值替换为 (𝑥−𝑀)/𝑆，其中x表示某个神经元的原始值。  

这有什么帮助呢？这基本上是稳定了输入向量，有助于训练深层网络。一个顾虑是，归一化输入会不会去除掉一些对学习目标有用的信息？

为了解决这个问题，层归一化层引入了一个Scale和Bias参数。具体而言，对于每个神经元，你只需将其乘以一个标量，然后加上一个偏置。这些标量和偏置值都是可训练的参数。这使得网络能够学到可能对预测有价值的一些变化。由于这些是唯一的参数，层归一化块并不需要大量的训练参数。整个过程如图所示：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

Scale和Bias是可训练的参数。可以看到，层归一化是相对简单的模块，其中每个数字都只进行逐点操作（在初始均值和标准差计算之后）。这让我们想起了激活层（例如RELU），关键区别在于这里我们有一些可训练的参数（因为操作简单，所以比其他层少得多）。

标准差是一种统计度量，用于衡量值的分散程度。例如，如果所有值都相同，那么标准差为零。如果每个值与他们的平均值之间距离较大，那么标准差就会很高。计算一组数字（例如N个数字a1, a2, a3...）的标准差公式如下：从每个数字中减去这些数字的平均值，然后对每个N个数字的答案进行平方。将所有这些数字相加，然后除以N。最后对所得结果取平方根。

对于初学者来说：有经验的机器学习专业人士会注意到，这里没有讨论Batch Norm。实际上，我们甚至没有在本文中引入批次Batch的概念。在大多数情况下，我认为，批次是另一个与理解核心概念无关的训练加速手段（除了我们这里不需要的Batch Norm之外）。

**11**

**Dropout**

Dropout是一种简单但有效的避免模型过拟合的技术。过拟合是指当你使用训练数据训练模型时，模型在该数据集上表现良好，但不能很好泛化到模型未见过的样本。帮助我们避免过拟合的技术称为“ **正则化技术** ”，Dropout就是其中之一。

如果你训练一个模型，它可能会在数据上出错和/或以特定方式过拟合。如果你训练另一个模型，它可能会以不同的方式做同样的事情。如果你训练了多个这样的模型并平均了输出结果呢？这些通常被称为“ **集成模型** ”，因为它们通过组合来自一组模型的输出以进行预测，而集成模型通常比任何单个模型表现得更好。

在神经网络中，你也可以做同样的事情。你可以构建多个（稍微不同的）模型，然后将它们的输出结合起来，以获得更好的模型。然而，这可能会造成高昂的计算成本。Dropout是一种技术，它并非完全构建集成模型，但确实捕捉到了这种概念的某些精髓。

这个概念很简单，通过在训练期间插入一个dropout层，你所做的就是随机删除一定比例的所插入dropout层之间神经元连接。参考我们的初始网络，在输入和中间层之间插入一个Dropout层，dropout率为50%，看起来就像这样：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

现在，这促使网络在具备大量冗余的条件下开展训练。本质上，你同时训练了多个不同的模型——但它们共享权重。

现在，对于推理，我们可以采用与集成模型相同的方法。我们可以使用Dropout进行多次预测，然后将它们结合起来。不过，由于这样做计算量很大，并且我们的模型共享权重，那为何我们不直接使用所有权重进行一次预测呢（即不是一次只使用50%的权重，而是同时使用全部权重）。这应该能为我们提供一些近似于集成模型所提供的结果。

不过有一个问题：使用50%权重训练的模型与使用所有权重的模型在中间神经元中的数字会有很大不同。我们想要的是更接近集成风格的平均值。我们如何做到这一点？一个简单的方法是，只需取所有权重并乘以0.5，因为我们现在使用的权重是原来的两倍。这就是Droput在推理过程中所做的。它将使用具有所有权重的完整网络，并将权重乘以(1- p)，其中p是删除概率。这已被证明是一种非常有效的正则化技术。

**12**

**多头注意力机制**

这是Transformer架构中的关键模块。我们已经了解了什么是注意力模块。回想一下，注意力模块的输出是由用户决定的，它是v向量的长度。多头注意力模块的基本思想是，并行多个注意力模块（它们都接受相同的输入）。然后我们取它们所有输出并简单地将它们连接起来。它看起来像这样：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

请注意，从v1到v1h1的箭头是线性层——每个箭头上都有一个矩阵进行转换。我只是没有显示它们以免产生混淆。

我们为每个头生成相同的键、查询和值，然后在使用这些k,q,v值之前，分别对每个k,q,v和每个头应用一个线性变换。这个额外的层在自注意力中不存在。

附带说明一下，对我来说，这种构建多头注意力机制的方式着实令人感到意外。例如，与其添加新层并共享这些权重为什么不为每个头创建单独的Wk、Wq、Wv矩阵。如果你了解的话，请告诉我——我的确不太清楚。

**13**

**嵌入和位置编码**

我们在自注意力部分简要讨论了使用位置编码的动机。那这些动机是什么呢？虽然图片显示了位置编码，但使用位置嵌入比使用编码更常见。因此，我们在这里讨论一种常见的位置嵌入，但附录还介绍了原始论文中使用的位置编码。位置嵌入与任何其他嵌入没有什么不同，只是相比嵌入词汇表，我们将嵌入数字1、2、3 等。因此，这个嵌入是一个与词嵌入长度相同的矩阵，每列对应一个数字。这就是它的全部内容。

**14**

**GPT架构**

让我们来谈谈GPT架构。这是大多数GPT模型中使用的架构（各有差异）。如果你阅读了本文之前的内容，那么理解这一点应该相当容易。架构在高层次上看起来如下：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

至此，除了“GPT Transformer Block”之外，所有其他块都已详细讨论过。这里的+号只是表示两个向量相加（这意味着两个嵌入向量必须具有相同的大小）。让我们看看这个GPT Transformer Block：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

这就是全部了。这里之所以称之为“transformer”，是因为它由transformer衍生而来并且是前者的一种类型——我们将在下一节中讨论这种架构。这并不影响理解，因为我们之前已经介绍了这里显示的所有构建块。让我们回顾一下到目前为止我们在构建这个GPT架构时所介绍的所有内容：

- 我们了解了神经网络如何接收数字并输出其他数字，以及如何将权重作为可训练的参数
- 我们可以对这些输入/输出数字进行解释，并赋予神经网络实际意义
- 我们可以将神经网络连接起来，创建更大的神经网络，我们可以将每个神经网络称为一个“块”，并用方框表示，以使图表更容易理解。每个块仍然做同样的事情，接收一堆数字并输出另一堆数字
- 我们学习了很多不同类型的模块，它们有不同的用途
- GPT只是这些模块的一种特殊排列，如上所示，我们在第1部分中讨论其解释

随着各公司逐步构建起强大的现代大语言模型，随着时间的推移对其进行了一些修改，但基本原理仍然相同。

现在，这个GPT transformer实际上就是在最初引入transformer架构的那篇论文中所称的“解码器”。让我们来了解一下。

**15**

**Transformer结构**

这是最近推动语言模型功能快速发展的关键创新之一。Transformer不仅提高了预测准确性，而且比以前的模型（训练）更容易/更高效，允许更大的模型尺寸。上述GPT架构就是基于此运作的。

如果你查看GPT的架构，你会发现它非常擅长生成序列中的下一个单词。它从根本上遵循了我们第一部分讨论的相同逻辑。从几个单词开始，然后一次生成一个。但是，如果你想进行翻译呢。如果你有一个德语句子（例如“Wo wohnst du?” = “Where do you live?”），并且你想将其翻译成英语。我们又该如何训练模型？

首先，我们需要找到一种方法来输入德语单词。这意味着我们需要扩展嵌入式功能，包括德语和英语。现在，我想这里有一种简单的方法来输入信息。我们为什么不干脆在已经生成的英语前面加上德语句子，然后将其作为上下文输入给模型呢？为了使事情对模型来说更容易，我们可以添加一个分隔符。每次步骤操作如图所示：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

这将会起作用，但还有改进空间：

- 如果上下文长度是固定的，有时原始句子会丢失。
- 在这个模型中，有很多东西需要学习。同时学习两种语言，但还需要知道<SEP>是分隔符词元，需要从这里开始翻译。
- 你正在对整个德语句子进行处理，每次生成一个单词时，都会有一个不同的偏移量。这意味着对于同一事物会有不同的内部表示，并且模型应该能够处理所有这些情况以进行翻译。

Transformer最初是为这个任务而创建的，它由“编码器”和“解码器”两部分组成——这两部分基本上是两个独立的板块。一个板块只是接收德语句子，并给出一个中间表示（又是一堆数字）——这个中间表示被称为编码器。

第二个板块生成单词（到目前为止，我们已经看了很多这样的内容）。唯一不同的是，除了提供到目前为止生成的单词外，我们还会提供编码的德语句子（来自编码器块）。因此，当它在生成语言时，它的上下文基本上是到目前为止生成的所有单词，再加上德语。这个块被称为解码器。

这些编码器和解码器均由几个块组成，特别是夹在其他层之间的注意力块。让我们看一下论文“Attention is all you need”中transformer的图示，并尝试理解它：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

左侧的垂直块组称为“编码器”，右侧的垂直块组称为“解码器”。让我们回顾并了解之前尚未涉及的内容：

*重温如何阅读图表* ：这里的每个框都是一个块，它以神经元的形式接收一些输入，并输出一组神经元作为输出，然后可以由下一个块处理或由我们解释。箭头显示块的输出去向。如图所见，我们通常会获取一个块的输出并将其输入到多个块中。让我们在这里逐一介绍一下：

前馈：前馈网络是不包含循环的网络。第1节中的原始网络就是前馈网络。事实上，此块使用的结构非常相似。它包含两个线性层，每个层后跟一个RELU（请参阅第一节中关于RELU的注释）和一个dropout层。请记住，此前馈网络独立应用于每个位置。这意味着，位置0上的信息具有前馈网络，位置1上的信息具有前馈网络，依此类推，但是来自位置x的神经元与位置y的前馈网络没有联系。这很重要，因为如果我们不这样做，在训练期间网络就可以通过向前看来作弊。

*交叉注意力* ：你会注意到解码器具有多头注意力，箭头来自编码器。这是怎么回事？还记得自注意力和多头注意力中的值、键、查询吗？它们都来自同一个序列。事实上，查询只是来自序列的最后一个字。那么，如果我们保留查询，但从完全不同的序列中获取值和键，会怎么样？这里就是这种情况。值和键来自编码器的输出。除了键和值的输入来源外，数学上没有任何变化。

*Nx* ：这里的Nx只是表示这个块被链式重复了N次。所以基本上你是在背靠背堆叠块，并将前一个块的输入传递到下一个块。这是一种使神经网络更深的方法。现在，看看这个图，关于编码器输出如何馈送到解码器，可能会让人感到困惑。假设N=5。我们是否将每个编码器层的输出馈送到相应的解码器层？不。基本上你只运行一次编码器。然后你只需采用该表示并将相同的东西馈送到5个解码器层中的每一个。

*Add & Norm块* ：这基本上与下面的相同

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

现在你对Transformer架构有了完整的理解，这包括从简单的加法和乘法操作到完全自包含的内容！你知道每行、每个和、每个框和每个单词意味着什么，以及从零开始构建它们意味着什么。从理论上讲，这些笔记包含了你从零开始编写Transformer所需的一切信息。实际上，如果你对此感兴趣，这个代码仓库为上述GPT架构实现了从零开始构建的过程（ *https://github.com/karpathy/nanoGPT* ）。

**16**

**附录**

**矩阵乘法**

我们在上文有关嵌入的内容中介绍了向量和矩阵。矩阵有两个维度（行数和列数）。向量也可以被认为是其中一个维度等于1的矩阵。两个矩阵的乘积定义如下：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

点代表乘法。现在让我们再看一下第一张图片中蓝色和神经元的计算。如果我们将权重写成矩阵，将输入写成向量，我们可以按以下方式写出整个操作：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

如果权重矩阵称为“W”，输入称为“x”，则Wx是结果（在本例中为中间层）。我们也可以对两者进行转置，并将其写为xW——这取决于个人喜好。

**标准差**

在“层归一化”部分中，我们使用了标准差的概念。标准差是一组数值中数值分布的统计量度，例如，如果数值全部相同，则标准差为零。如果一般而言，每个数值与这些相同数值的平均值相差甚远，则标准差会很高。计算一组数值a1、a2、a3……（假设为 N 个数值）的标准差的公式大致如下：从每个数值中减去（这些数值的）平均值，然后对N个数值中的每一个求平方。将所有这些数值相加，然后除以N。最后对所得结果取平方根。

**位置编码**

我们上面讨论了位置嵌入。位置编码只是一个与词嵌入向量长度相同的向量，只不过它并不属于嵌入，因为其没有经过训练。我们只是为每个位置分配一个唯一的向量，例如，位置1有一个不同的向量，位置2有一个不同的向量，依此类推。一个简单的方法是让该位置的向量完全充满位置编号。因此，位置1的向量将是 \[1,1,1…1\]，位置2的向量将是 \[2,2,2…2\]，依此类推（记住，每个向量的长度必须与嵌入长度匹配，加法才能起作用）。这是有问题的，因为我们最终会在向量中得到很大的数字，这会在训练期间带来挑战。当然，我们可以通过将每个数字除以位置的最大值来归一化这些向量，因此如果总共有3个单词，则位置1为 \[.33,.33,..,.33\]，位置2为 \[.67,.67,..,.67\]，依此类推。现在问题在于，我们不断改变位置1的编码（当我们将4个单词的句子作为输入时，这些数字会有所不同），这给网络学习带来了挑战。所以在这里，我们需要一个为每个位置分配唯一向量的方案，并且数字不会爆炸。基本上，如果上下文长度为d（即，我们可以输入到网络中以预测下一个词元/单词的最大词元/单词数量，请参阅“how does it all generate language?”部分中的讨论），并且嵌入向量的长度为10（假设），那么我们需要一个有10行和d列的矩阵，其中所有列都是唯一的，并且所有数字都介于0和1之间。鉴于0和1之间有无数个数字，并且矩阵的大小有限，因此可以通过多种方式来实现。

“Attention is all you need”论文中使用的方法如下：

- 绘制10条正弦曲线，每条曲线为si(p) = sin (p/10000(i/d))（即 10k 的 i/d 次方）
- 用数字填充编码矩阵，使得第 (i,p) 个数字是 si(p)，例如，对于位置1，编码向量的第5个元素是s5(1)=sin (1/10000(5/d))

为什么选择这种方法？通过改变10k的功率，你可以改变在p轴上看到的正弦函数的幅度。如果你有10个不同的正弦函数，它们具有10个不同的幅度，那么要花很长时间才能得到重复现象（即所有10个值都相同）来改变p的值。这有助于为我们提供唯一的值。现在，实际的论文同时使用正弦和余弦函数，编码形式为：如果i为偶数，则si(p) = sin (p/10000(i/d))；如果i为奇数，则si(p) = cos(p/10000(i/d))。

**版权声明**

版权属于原作者，仅用于学术分享

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

文章精选：

1.[图灵奖得主杨立昆深入浅出带你了解人工智能的前世今生](https://mp.weixin.qq.com/s?__biz=MzIyMzk1MDE3Nw==&mid=2247657341&idx=1&sn=37574a40e61e1bff490ce771491e14da&scene=21#wechat_redirect)

2.[图灵奖得主辛顿：我的五十年深度学习生涯与研究心法](http://mp.weixin.qq.com/s?__biz=MzIyMzk1MDE3Nw==&mid=2247652237&idx=5&sn=5502e874794d9caff58b02b2cf679d5e&chksm=e81ab783df6d3e95ea520543f18a1f1d56e886a95d376767e826cb928bb76aa4e7ddcab28520&scene=21#wechat_redirect)

3.[图灵奖和诺贝尔奖双料得主辛顿的冬与春](https://mp.weixin.qq.com/s?__biz=MzIyMzk1MDE3Nw==&mid=2247657244&idx=1&sn=671fe382a064b34ab6b6d49c9894df8a&scene=21#wechat_redirect)

4.[诺奖得主、DeepMind创始人：AI离彻底改变人类社会的能力只有10年](http://mp.weixin.qq.com/s?__biz=MzIyMzk1MDE3Nw==&mid=2247656516&idx=1&sn=8bf446664770fb57de98296f3a524272&chksm=e81a404adf6dc95cba08f102d8428113dd8fbc14a80e8277e1f0586a6663ee4f70196de58852&scene=21#wechat_redirect)  

5.[2024诺奖颁奖现场，AI之父Hinton演讲：当AI已经开始理解人类的喜好和情绪（附视频）](https://mp.weixin.qq.com/s?__biz=MzIyMzk1MDE3Nw==&mid=2247658499&idx=1&sn=8e7ebbd84b7d7fbdb2672d73bb7a5bec&scene=21#wechat_redirect)

6.[图灵奖得主杰弗里·辛顿：从小语言到大语言，人工智能究竟如何理解人类？](http://mp.weixin.qq.com/s?__biz=MzIyMzk1MDE3Nw==&mid=2247654301&idx=1&sn=b9fcf37b65f005392129ddfcf1cd76ad&chksm=e81abf93df6d3685819385fab7034299fdfdc98d70594f3a6b085e18400e0c7635c828f200b4&scene=21#wechat_redirect)

7.[图灵奖得主Bengio预言o1无法抵达AGI！Nature权威解读AI智能惊人进化，终极边界就在眼前](https://mp.weixin.qq.com/s?__biz=MzIyMzk1MDE3Nw==&mid=2247658428&idx=1&sn=1bfa9d1fc2f9a381a16978c2d1d1550e&scene=21#wechat_redirect)

8.[强化学习之父Sutton最新万字采访：炮轰深度学习只是瞬时学习，持续学习才是智能突破的关键](http://mp.weixin.qq.com/s?__biz=MzIyMzk1MDE3Nw==&mid=2247656768&idx=1&sn=d72f7ecf7cae0de1c85e48d16a3d3bb3&chksm=e81a414edf6dc858d83dcc16433d20619d67866f9b84cc752396f17d8004704e4e3f5f5a3ccd&scene=21#wechat_redirect)

9.[斯坦福李飞飞 《AI Agent：多模态交互前沿调查》 论文](https://mp.weixin.qq.com/s?__biz=MzIyMzk1MDE3Nw==&mid=2247657596&idx=1&sn=2815e1cc1021c9a6ec337a8dfc6f2f22&scene=21#wechat_redirect)

10.[图灵奖得主杰弗里·辛顿：从小语言到大语言，人工智能究竟如何理解人类？](https://mp.weixin.qq.com/s?__biz=MzIyMzk1MDE3Nw==&mid=2247654301&idx=1&sn=b9fcf37b65f005392129ddfcf1cd76ad&scene=21#wechat_redirect)

继续滑动看下一个

图灵人工智能

向上滑动看下一个

![kimi](data:image/png;base64,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)