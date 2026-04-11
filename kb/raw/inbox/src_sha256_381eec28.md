---
title: "[翻譯] 認識 x64 程式碼模型（code model）"
source: "https://alittleresearcher.blogspot.com/2017/03/understanding-the-x64-code-models.html"
author:
  - "[[Ernie]]"
published: 2017-03-17
created: 2026-04-11
description: "原文標題：Understanding the x64 code models  原文網址： http://eli.thegreenplace.net/2012/01/03/understanding-the-x64-code-models  原文作者：Eli Bendersky..."
tags:
  - "clippings"
---
- 原文標題：Understanding the x64 code models
- 原文網址： [http://eli.thegreenplace.net/2012/01/03/understanding-the-x64-code-models](http://eli.thegreenplace.net/2012/01/03/understanding-the-x64-code-models)
- 原文作者：Eli Bendersky
- 原文發表時間：2012 年 01 月 03 日
- 譯註：  
	- 文中的反組譯內容使用的是 AT&T 格式的 [組合語言語法](https://en.wikipedia.org/wiki/X86_assembly_language#Syntax) 。
		- 關於「code model」的正體中文翻譯，有 **程式碼模型** 、 **程式碼模式** 、 **編碼式樣** 等，在本文中，一律採取「程式碼模型」。

==↓↓↓↓↓↓ 正文開始 ↓↓↓↓↓↓==

在撰寫用於 x64 架構程式碼的時候，一個會出現的有趣議題是要使用哪個程式碼模型（code model），儘管這可能不是一個廣為人知的主題，但如果有人想要理解編譯器所產生的 x64 機器碼，則熟悉程式碼模型就有了教育意義；而對於那些真的很在乎效能，直到每個細小指令的人來說，該主題對最佳化（optimization）也會有影響。

無論在網路或其他地方，關於這個主題都只有很少的資訊，到目前為止，最重要的資訊是官方的 x64 ABI，可以從 [x86-64.org](http://www.x86-64.org/) 的頁面取得 [1](#fn:linux-foundation "See footnote") （從現在起，我會簡單地用「ABI」來指稱它），還有一些資訊會在 `gcc` 的 man-page 裡。本文旨在提供一份容易取得的參考資料，包括一些該主題的討論和具體範例，從真實生活中的程式碼裡來證實概念。

重要聲明：這不是給初學者的教學文件，其前提是對於 C 與組合語言有完整的了解，再加上對 x64 架構的基礎認識。

## 程式碼模型——源起

在 x64 上，對程式碼和資料的參照（reference）都是由相對於指令碼的定址模式（在 x64 的標準說法是 RIP 相對定址（RIP-relative addressing））來完成的，但相對於這些指令的 RIP 的偏移值（offset）被限制在 32 位元，那麼，在 32 位元不夠用的時候，該怎麼辦呢？假如程式比 2 GB 還大會怎麼樣呢？因此，會出現一種情況，一個指令剛好嘗試去定位某個不能以相對於 RIP 的 32 位元偏移值來處理的程式碼（或資料）片段。

這個問題的一個解決方法是捨棄 RIP 相對定址模式，對所有程式碼與資料參照都使用 64 位元的絕對偏移值，可是這有很高的代價——即使是進行最簡單的運算，也會需要更多的指令。僅僅為了（極少見的）超大程式或函式庫，就在 *所有* 程式碼上這樣做，要付出很高的代價。

正因如此，其折衷方法就是程式碼模型 [〔1〕](#ref-1) ，程式碼模型是程式撰寫者和編譯器之間的正式協議，程式撰寫者對當下正要被編譯的目的檔（object file）所要產出的最終程式大小這一方面做出聲明 [〔2〕](#ref-2) 。

程式碼模型的存在，是為了讓程式撰寫者能夠告訴編譯器：「別擔心，這個目的檔只會放進非巨大程式，所以你可以放心使用快速的 RIP 相對定址模式」；反過來說，他也可以告訴編譯器：「這個目的檔預計要連結進巨大程式，因此請使用緩慢但安全的絕對定址模式，配上完全 64 位元的偏移值」。

## 此處將涵蓋什麼

上面描述的兩種方案都有名字： *小型程式碼模型* 向編譯器承諾在被編譯目的檔中，對於所有的程式與資料參照，32 位元相對偏移值就會夠用了；另一方面， *大型程式碼模型* 告訴它對於所有的程式與資料參照，不要做任何的假設，並使用 64 位元絕對定址模式。更有趣的是，這裡還有一條中庸之道，叫做 *中型程式碼模型* 。

這些程式碼模型還能各自分成非 PIC 程式碼和 PIC 程式碼，本文將會討論這全部六種變體。

## 範例 C 原始碼

我將會使用下面的 C 程式，並以不同的程式碼模式編譯，用來證實本文中所探討的觀念，在這份程式碼裡面，函式 `main` 存取了四個不同的全域陣列和一個全域函式，這些陣列在兩個因素上各有不同：尺寸大小和可見性（visibility） [2](#fn:about-visibility "See footnote") ，尺寸大小對於解釋中型程式碼模型來說很重要，而對小型與大型模型沒有影響；可見性則要嘛是靜態的（只在本原始碼檔案中是可見的），要嘛是完全全域的（對所有其它連結到程式的目的檔是可見的），這項分別對 PIC 程式碼模型而言是重要的。

```
int global_arr[100] = {2, 3};
static int static_arr[100] = {9, 7};
int global_arr_big[50000] = {5, 6};
static int static_arr_big[50000] = {10, 20};

int global_func(int param)
{
    return param * 10;
}

int main(int argc, const char* argv[])
{
    int t = global_func(argc);
    t += global_arr[7];
    t += static_arr[7];
    t += global_arr_big[7];
    t += static_arr_big[7];
    return t;
}
```

`gcc` 用選項 `-mcmodel` 的值來決定程式碼模型，此外，PIC 的編譯可以由旗標 `-fpic` 來指定。

舉例來說，將該程式碼編譯成啟用大型程式碼模型與 PIC 的目的檔：

```
> gcc -g -O0 -c codemodel1.c -fpic -mcmodel=large -o codemodel1_large_pic.o
```

## 小型程式碼模型（small code model）

這裡是 `man gcc` 所回應有關小型程式碼模型的部分：

> **\-mcmodel=small**
> 
> 生成用於小型程式碼模型的指令碼：程式以及它的符號（symbol）必須被連結到位址空間低位的 2 GB 中，指標是 64 位元的，程式可以是靜態或動態連結的。這是預設的程式碼模型。

換句話說，編譯器可以隨意假設所有的程式碼和資料，都可以從程式碼中的任何指令使用 32 位元的 RIP 相對偏移值來存取。來看看範例 C 程式以非 PIC 的小型程式碼模型做編譯的反組譯結果：

```
> objdump -dS codemodel1_small.o
[...]
int main(int argc, const char* argv[])
{
  15: 55                      push   %rbp
  16: 48 89 e5                mov    %rsp,%rbp
  19: 48 83 ec 20             sub    $0x20,%rsp
  1d: 89 7d ec                mov    %edi,-0x14(%rbp)
  20: 48 89 75 e0             mov    %rsi,-0x20(%rbp)
    int t = global_func(argc);
  24: 8b 45 ec                mov    -0x14(%rbp),%eax
  27: 89 c7                   mov    %eax,%edi
  29: b8 00 00 00 00          mov    $0x0,%eax
  2e: e8 00 00 00 00          callq  33 <main+0x1e>
  33: 89 45 fc                mov    %eax,-0x4(%rbp)
    t += global_arr[7];
  36: 8b 05 00 00 00 00       mov    0x0(%rip),%eax
  3c: 01 45 fc                add    %eax,-0x4(%rbp)
    t += static_arr[7];
  3f: 8b 05 00 00 00 00       mov    0x0(%rip),%eax
  45: 01 45 fc                add    %eax,-0x4(%rbp)
    t += global_arr_big[7];
  48: 8b 05 00 00 00 00       mov    0x0(%rip),%eax
  4e: 01 45 fc                add    %eax,-0x4(%rbp)
    t += static_arr_big[7];
  51: 8b 05 00 00 00 00       mov    0x0(%rip),%eax
  57: 01 45 fc                add    %eax,-0x4(%rbp)
    return t;
  5a: 8b 45 fc                mov    -0x4(%rbp),%eax
}
  5d: c9                      leaveq
  5e: c3                      retq
```

如同我們所見，所有的陣列都用相同的手段來存取——藉由使用一個簡單的 RIP 相對偏移值，然而，指令碼裡的偏移值卻是 0，這是因為編譯器並不知道資料區段（data section）會被放在哪裡，因此它同時也會為每個這樣的存取都產生一筆重定位（relocation）項目：

```
> readelf -r codemodel1_small.o

Relocation section '.rela.text' at offset 0x62bd8 contains 5 entries:
  Offset          Info           Type           Sym. Value    Sym. Name + Addend
00000000002f  001500000002 R_X86_64_PC32     0000000000000000 global_func - 4
000000000038  001100000002 R_X86_64_PC32     0000000000000000 global_arr + 18
000000000041  000300000002 R_X86_64_PC32     0000000000000000 .data + 1b8
00000000004a  001200000002 R_X86_64_PC32     0000000000000340 global_arr_big + 18
000000000053  000300000002 R_X86_64_PC32     0000000000000000 .data + 31098
```

讓我們用徹底解碼對 `global_arr` 的存取來當作例子，這裡再次給出反組譯結果中的相關部分：

```
t += global_arr[7];
36:       8b 05 00 00 00 00       mov    0x0(%rip),%eax
3c:       01 45 fc                add    %eax,-0x4(%rbp)
```

RIP 相對定址是相對於下個指令的位址的，所以該修補進指令 `mov` 的偏移值應該是要相對於 0x3c。而相關的重定位項目是第二筆項目，指向 `mov` 在 0x38 處的運算元（oprand），且該項目是 `R_X86_64_PC32` ，意指：「取得符號的值，加上該加數（addend），並減去本重定位所指向的偏移值」，假如你照它說的計算了，你會看見到最後放進去的，就是下個指令跟 `global_arr` 加上 0x1c 之間的相對偏移值，這個偏移值就是我們需要的，因為 0x1c 只是單純表示「陣列中的第 7 個 `int` 」（在 x64 上每個 `int` 是 4 個位元組）而已，如此一來，該指令便能正確地利用 RIP 相對定址來參照 `global_arr[7]` 。

在這裡有另一個有趣的地方要注意，那就是雖然用來存取 `static_arr` 的指令是相似的，但是它的重定位項目卻有著不同的符號，指向區段 `.data` 而不是被指定的符號，這是因為該靜態陣列被連結器放在區段 `.data` 的一個已知的地方——它不能跟其它共享函式庫做分享，而這筆重定位最終會被連結器完全解析（resolve）；另一方面，對 `global_arr` 的參照會留給動態連結器去解析，因為 `global_arr` 實際上是可以被不同的共享函式庫使用（或覆寫）的 [〔3〕](#ref-3) 。

最後，來看看對 `global_func` 的參照：

```
int t = global_func(argc);
24:       8b 45 ec                mov    -0x14(%rbp),%eax
27:       89 c7                   mov    %eax,%edi
29:       b8 00 00 00 00          mov    $0x0,%eax
2e:       e8 00 00 00 00          callq  33 <main+0x1e>
33:       89 45 fc                mov    %eax,-0x4(%rbp)
```

`callq` 的運算元也是相對於 RIP 的，所以這裡的 `R_X86_64_PC32` 重定位項目用同樣方法運作，把相對於 `global_func` 的真正偏移值放到其運算元。

總結一下，由於小型程式碼模型向編譯器承諾，在最終的程式當中的所有程式碼與資料，都可以用 32 位元的 RIP 相對偏移值做存取，所以編譯器可以產生簡單有效的指令碼，來存取所有類型的物件。

## 大型程式碼模型（large code model）

取自 `man gcc` ：

> **\-mcmodel=large**
> 
> 生成用於大型程式碼模型的指令碼：此模型不針對位址和區段大小做任何假設。

這裡是以非 PIC 的大型程式碼模型編譯 `main` 的反組譯程式碼。

```
int main(int argc, const char* argv[])
{
  15: 55                      push   %rbp
  16: 48 89 e5                mov    %rsp,%rbp
  19: 48 83 ec 20             sub    $0x20,%rsp
  1d: 89 7d ec                mov    %edi,-0x14(%rbp)
  20: 48 89 75 e0             mov    %rsi,-0x20(%rbp)
    int t = global_func(argc);
  24: 8b 45 ec                mov    -0x14(%rbp),%eax
  27: 89 c7                   mov    %eax,%edi
  29: b8 00 00 00 00          mov    $0x0,%eax
  2e: 48 ba 00 00 00 00 00    movabs $0x0,%rdx
  35: 00 00 00
  38: ff d2                   callq  *%rdx
  3a: 89 45 fc                mov    %eax,-0x4(%rbp)
    t += global_arr[7];
  3d: 48 b8 00 00 00 00 00    movabs $0x0,%rax
  44: 00 00 00
  47: 8b 40 1c                mov    0x1c(%rax),%eax
  4a: 01 45 fc                add    %eax,-0x4(%rbp)
    t += static_arr[7];
  4d: 48 b8 00 00 00 00 00    movabs $0x0,%rax
  54: 00 00 00
  57: 8b 40 1c                mov    0x1c(%rax),%eax
  5a: 01 45 fc                add    %eax,-0x4(%rbp)
    t += global_arr_big[7];
  5d: 48 b8 00 00 00 00 00    movabs $0x0,%rax
  64: 00 00 00
  67: 8b 40 1c                mov    0x1c(%rax),%eax
  6a: 01 45 fc                add    %eax,-0x4(%rbp)
    t += static_arr_big[7];
  6d: 48 b8 00 00 00 00 00    movabs $0x0,%rax
  74: 00 00 00
  77: 8b 40 1c                mov    0x1c(%rax),%eax
  7a: 01 45 fc                add    %eax,-0x4(%rbp)
    return t;
  7d: 8b 45 fc                mov    -0x4(%rbp),%eax
}
  80: c9                      leaveq
  81: c3                      retq
```

再次看看重定位項目，這很有用：

```
Relocation section '.rela.text' at offset 0x62c18 contains 5 entries:
  Offset          Info           Type           Sym. Value    Sym. Name + Addend
000000000030  001500000001 R_X86_64_64       0000000000000000 global_func + 0
00000000003f  001100000001 R_X86_64_64       0000000000000000 global_arr + 0
00000000004f  000300000001 R_X86_64_64       0000000000000000 .data + 1a0
00000000005f  001200000001 R_X86_64_64       0000000000000340 global_arr_big + 0
00000000006f  000300000001 R_X86_64_64       0000000000000000 .data + 31080
```

大型程式碼模型也是完全一致的——對於程式碼與資料區段都不做假設，因此所有資料都以同樣方式存取。讓我們再把 `global_arr` 單獨抽出來一次：

```
t += global_arr[7];
3d:       48 b8 00 00 00 00 00    movabs $0x0,%rax
44:       00 00 00
47:       8b 40 1c                mov    0x1c(%rax),%eax
4a:       01 45 fc                add    %eax,-0x4(%rbp)
```

在這裡，從陣列抽出想要的值需要兩個指令，第一個指令把 64 位元絕對位址放進 `rax` ，我們很快會看到，這就是 `global_arr` 的位址；第二個指令把 `(rax) + 0x1c` 處的字組載入 `eax` 。

因此，讓我們聚焦在 0x3d 處的指令上，它是一個 `movabs` ，x64 上 `mov` 的 64 位元絕對數值版本，可以運送一個 64 位元的立即值（immediate）到暫存器。而在反組譯程式碼中，這個立即值是 0，所以我們換個方向，從重定位表尋求解答，該指令有個針對 0x3f 處運算元的 `R_X86_64_64` 重定位，它單純表示——用符號值 + 加數放回該偏移值，換句話說， `rax` 將持有 `global_arr` 的絕對位址。

那函式呼叫又是如何呢？

```
int t = global_func(argc);
24:       8b 45 ec                mov    -0x14(%rbp),%eax
27:       89 c7                   mov    %eax,%edi
29:       b8 00 00 00 00          mov    $0x0,%eax
2e:       48 ba 00 00 00 00 00    movabs $0x0,%rdx
35:       00 00 00
38:       ff d2                   callq  *%rdx
3a:       89 45 fc                mov    %eax,-0x4(%rbp)
```

在熟悉的 `movabs` 之後，有一個 `call` 指令會呼叫函式，而函式位址放在 `rdx` ，再看一眼相關的重定位，這很明顯跟資料存取是非常類似的。

顯然，大型程式碼模式真的沒有對程式與資料區段的大小，或是符號最後落在什麼地方做任何假設，在每個地方都採用「安全手段」，用 64 位元的絕對數值搬移指令來存取任何符號，當然，這是有代價的，我們可以注意到相較於小型模型，現在要存取任何符號，都要多用一個額外指令。

所以，我們剛剛見證了兩種極端，小型模型開心的假設每樣東西都會落在記憶體低位的 2 GB；而大型模型則假設每件事都有可能，且符號可以落在完全 64 位元位址空間的任何地方。而中型程式碼模型就是兩者間的折衷方案。

## 中型程式碼模型（medium code model）

跟前面一樣，讓我們從取自 `man gcc` 的引文開始：

> **\-mcmodel=medium**
> 
> 生成用於用於中型程式碼模型的指令碼：程式會被連結到位址空間低位的 2 GB，小符號也會被放在那裡；大小超過 `-mlarge-data-threshold` 的符號則被放進大型資料或 bss 區段，並且可以落在 2 GB 之上。程式可以是靜態或動態連結的。

類似於小型程式碼模型，中型程式碼模型假設所有程式碼被連結在低位的 2 GB；但另一方面，資料則分割成「大型資料」和「小型資料」，小型資料也被假設連結在低位的 2 GB，另一方面，大型資料並不對其記憶體位置做限制。當資料比某個給定的門檻值選項來得大時，就會被認定為大型資料，該門檻值預設是 64 KB。

有個要注意的地方也很有趣，為了大型資料會建立特殊的區段——`.ldata` 和 `.lbss` （相較於 `.data` 和 `.bss` ）。然而，對於本文的目的來說，這不是很重要，所以我將會避開這個主題，去讀讀 ABI 可以取得更多細節。

現在，為什麼範例 C 程式要有那些 `_big` 的陣列，就應該清楚了吧，這些陣列對於中型程式碼模型來說，會被認定成「大型資料」（它們都是大概 200 KB 左右），這裡有反組譯的結果：

```
int main(int argc, const char* argv[])
{
  15: 55                      push   %rbp
  16: 48 89 e5                mov    %rsp,%rbp
  19: 48 83 ec 20             sub    $0x20,%rsp
  1d: 89 7d ec                mov    %edi,-0x14(%rbp)
  20: 48 89 75 e0             mov    %rsi,-0x20(%rbp)
    int t = global_func(argc);
  24: 8b 45 ec                mov    -0x14(%rbp),%eax
  27: 89 c7                   mov    %eax,%edi
  29: b8 00 00 00 00          mov    $0x0,%eax
  2e: e8 00 00 00 00          callq  33 <main+0x1e>
  33: 89 45 fc                mov    %eax,-0x4(%rbp)
    t += global_arr[7];
  36: 8b 05 00 00 00 00       mov    0x0(%rip),%eax
  3c: 01 45 fc                add    %eax,-0x4(%rbp)
    t += static_arr[7];
  3f: 8b 05 00 00 00 00       mov    0x0(%rip),%eax
  45: 01 45 fc                add    %eax,-0x4(%rbp)
    t += global_arr_big[7];
  48: 48 b8 00 00 00 00 00    movabs $0x0,%rax
  4f: 00 00 00
  52: 8b 40 1c                mov    0x1c(%rax),%eax
  55: 01 45 fc                add    %eax,-0x4(%rbp)
    t += static_arr_big[7];
  58: 48 b8 00 00 00 00 00    movabs $0x0,%rax
  5f: 00 00 00
  62: 8b 40 1c                mov    0x1c(%rax),%eax
  65: 01 45 fc                add    %eax,-0x4(%rbp)
    return t;
  68: 8b 45 fc                mov    -0x4(%rbp),%eax
}
  6b: c9                      leaveq
  6c: c3                      retq
```

注意 `_big` 陣列都如同大型模式裡一樣地存取，而其它陣列則是如同小型模式裡一樣地存取，函式也是如同小型模式裡一樣地存取。我不會連重定位也展示出來，因為它們裡面沒啥新的東西。

中型模型是小型與大型模型之間巧妙的折衷方式，程式的指令碼不太可能會非常大 [〔4〕](#ref-4) ，所以會導致程式超出 2 GB 界線的，就是資料當中靜態連結進來的大型片段（也許是為了某種方式的大查詢表）。中型程式碼模型將這些大型資料區塊從剩下的分離出來，並對它們特殊處理，所有只是呼叫函式或存取其他東西的，小一點的符號就會像在小型程式碼模型一樣有效了，只有指令碼確實存取到大型符號，才需要像大型程式碼模型那樣，走完全 64 位元的方法。

## 小型 PIC 程式碼模型（small PIC code model）

現在，轉到用於 PIC 的程式碼模型這邊來，再一次從小型模型起步 [〔5〕](#ref-5) ，這裡有該範例程式碼，以 PIC 及小型程式碼模型編譯：

```
int main(int argc, const char* argv[])
{
  15:   55                      push   %rbp
  16:   48 89 e5                mov    %rsp,%rbp
  19:   48 83 ec 20             sub    $0x20,%rsp
  1d:   89 7d ec                mov    %edi,-0x14(%rbp)
  20:   48 89 75 e0             mov    %rsi,-0x20(%rbp)
    int t = global_func(argc);
  24:   8b 45 ec                mov    -0x14(%rbp),%eax
  27:   89 c7                   mov    %eax,%edi
  29:   b8 00 00 00 00          mov    $0x0,%eax
  2e:   e8 00 00 00 00          callq  33 <main+0x1e>
  33:   89 45 fc                mov    %eax,-0x4(%rbp)
    t += global_arr[7];
  36:   48 8b 05 00 00 00 00    mov    0x0(%rip),%rax
  3d:   8b 40 1c                mov    0x1c(%rax),%eax
  40:   01 45 fc                add    %eax,-0x4(%rbp)
    t += static_arr[7];
  43:   8b 05 00 00 00 00       mov    0x0(%rip),%eax
  49:   01 45 fc                add    %eax,-0x4(%rbp)
    t += global_arr_big[7];
  4c:   48 8b 05 00 00 00 00    mov    0x0(%rip),%rax
  53:   8b 40 1c                mov    0x1c(%rax),%eax
  56:   01 45 fc                add    %eax,-0x4(%rbp)
    t += static_arr_big[7];
  59:   8b 05 00 00 00 00       mov    0x0(%rip),%eax
  5f:   01 45 fc                add    %eax,-0x4(%rbp)
    return t;
  62:   8b 45 fc                mov    -0x4(%rbp),%eax
}
  65:   c9                      leaveq
  66:   c3                      retq
```

還有重定位項目：

```
Relocation section '.rela.text' at offset 0x62ce8 contains 5 entries:
  Offset          Info           Type           Sym. Value    Sym. Name + Addend
00000000002f  001600000004 R_X86_64_PLT32    0000000000000000 global_func - 4
000000000039  001100000009 R_X86_64_GOTPCREL 0000000000000000 global_arr - 4
000000000045  000300000002 R_X86_64_PC32     0000000000000000 .data + 1b8
00000000004f  001200000009 R_X86_64_GOTPCREL 0000000000000340 global_arr_big - 4
00000000005b  000300000002 R_X86_64_PC32     0000000000000000 .data + 31098
```

由於在小型模型中，小型 vs. 大型資料的差別沒有出場的地方，我們將集中在區域（靜態）與全域符號間的差異，這才是在生成 PIC 時真正有戲份的角色。

如你所見，為靜態陣列生成的程式碼跟在非 PIC 的情況完全相同，這是 x64 架構所帶來的增益之一——除非符號必須在外部來存取，否則由於資料的 RIP 相對定址，你可以自由使用 PIC，而因為所使用的指令以及重定位都相同，所以我們不會再重講了。

這裡我們感興趣的情況是全域陣列，回憶一下，在 PIC 裡面，全域資料必須經由 GOT，因為它也許最後會在其他共享函式庫裡發現或使用 [〔6〕](#ref-6) 。這裡是用來存取 `global_arr` 所生成的指令碼：

```
t += global_arr[7];
36:   48 8b 05 00 00 00 00    mov    0x0(%rip),%rax
3d:   8b 40 1c                mov    0x1c(%rax),%eax
40:   01 45 fc                add    %eax,-0x4(%rbp)
```

而相關的重定位是 `R_X86_64_GOTPCREL` ，意指：「把 GOT 裡面為了該符號而產生之項目的位址，加上加數，再減去要加以重定位處的偏移值」，換句話說，（下個指令的）RIP 和 GOT 中為了 `global_arr` 而保留的空位之間的相對偏移值會修補進該指令裡面，所以在 0x36 的指令中，放進 `rax` 的東西就是 `global_arr` 的實際位址，而後接著的是，把 `global_arr` 的位址加上其第 7 個元素的偏移值做解參考，並放進 `eax` 。

現在，來調查看看函式呼叫：

```
int t = global_func(argc);
24:   8b 45 ec                mov    -0x14(%rbp),%eax
27:   89 c7                   mov    %eax,%edi
29:   b8 00 00 00 00          mov    $0x0,%eax
2e:   e8 00 00 00 00          callq  33 <main+0x1e>
33:   89 45 fc                mov    %eax,-0x4(%rbp)
```

有一筆 `R_X86_64_PLT32` 重定位是為了在 0x2e 的 `callq` 的運算元，這筆重定位代表：「為了該符號的 PLT 項目的位址加上加數，再減去要加以重定位處的偏移值」，換句話說， `callq` 應該能正確地為 `global_func` 呼叫 PLT 跳板（trampoline）。

注意編譯器所做的隱性假設——那就是 GOT 和 PLT 都可以用 RIP 相對定址來存取，拿這個模型跟其它 PIC 程式模型做比較時，這一點很重要。

## 大型 PIC 程式碼模型（large PIC code model）

這裡有反組譯結果：

```
int main(int argc, const char* argv[])
{
  15: 55                      push   %rbp
  16: 48 89 e5                mov    %rsp,%rbp
  19: 53                      push   %rbx
  1a: 48 83 ec 28             sub    $0x28,%rsp
  1e: 48 8d 1d f9 ff ff ff    lea    -0x7(%rip),%rbx
  25: 49 bb 00 00 00 00 00    movabs $0x0,%r11
  2c: 00 00 00
  2f: 4c 01 db                add    %r11,%rbx
  32: 89 7d dc                mov    %edi,-0x24(%rbp)
  35: 48 89 75 d0             mov    %rsi,-0x30(%rbp)
    int t = global_func(argc);
  39: 8b 45 dc                mov    -0x24(%rbp),%eax
  3c: 89 c7                   mov    %eax,%edi
  3e: b8 00 00 00 00          mov    $0x0,%eax
  43: 48 ba 00 00 00 00 00    movabs $0x0,%rdx
  4a: 00 00 00
  4d: 48 01 da                add    %rbx,%rdx
  50: ff d2                   callq  *%rdx
  52: 89 45 ec                mov    %eax,-0x14(%rbp)
    t += global_arr[7];
  55: 48 b8 00 00 00 00 00    movabs $0x0,%rax
  5c: 00 00 00
  5f: 48 8b 04 03             mov    (%rbx,%rax,1),%rax
  63: 8b 40 1c                mov    0x1c(%rax),%eax
  66: 01 45 ec                add    %eax,-0x14(%rbp)
    t += static_arr[7];
  69: 48 b8 00 00 00 00 00    movabs $0x0,%rax
  70: 00 00 00
  73: 8b 44 03 1c             mov    0x1c(%rbx,%rax,1),%eax
  77: 01 45 ec                add    %eax,-0x14(%rbp)
    t += global_arr_big[7];
  7a: 48 b8 00 00 00 00 00    movabs $0x0,%rax
  81: 00 00 00
  84: 48 8b 04 03             mov    (%rbx,%rax,1),%rax
  88: 8b 40 1c                mov    0x1c(%rax),%eax
  8b: 01 45 ec                add    %eax,-0x14(%rbp)
    t += static_arr_big[7];
  8e: 48 b8 00 00 00 00 00    movabs $0x0,%rax
  95: 00 00 00
  98: 8b 44 03 1c             mov    0x1c(%rbx,%rax,1),%eax
  9c: 01 45 ec                add    %eax,-0x14(%rbp)
    return t;
  9f: 8b 45 ec                mov    -0x14(%rbp),%eax
}
  a2: 48 83 c4 28             add    $0x28,%rsp
  a6: 5b                      pop    %rbx
  a7: c9                      leaveq
  a8: c3                      retq
```

以及其重定位項目：

```
Relocation section '.rela.text' at offset 0x62c70 contains 6 entries:
  Offset          Info           Type           Sym. Value    Sym. Name + Addend
000000000027  00150000001d R_X86_64_GOTPC64  0000000000000000 _GLOBAL_OFFSET_TABLE_ + 9
000000000045  00160000001f R_X86_64_PLTOFF64 0000000000000000 global_func + 0
000000000057  00110000001b R_X86_64_GOT64    0000000000000000 global_arr + 0
00000000006b  000800000019 R_X86_64_GOTOFF64 00000000000001a0 static_arr + 0
00000000007c  00120000001b R_X86_64_GOT64    0000000000000340 global_arr_big + 0
000000000090  000900000019 R_X86_64_GOTOFF64 0000000000031080 static_arr_big + 0
```

又一次，在這裡小型 vs. 大型資料的差別也是不重要的，所以我們將集中在 `static_arr` 和 `global_arr` 。在這個程式碼裡有個新的 prologue，是我們之前沒遇過的：

```
1e: 48 8d 1d f9 ff ff ff    lea    -0x7(%rip),%rbx
25: 49 bb 00 00 00 00 00    movabs $0x0,%r11
2c: 00 00 00
2f: 4c 01 db                add    %r11,%rbx
```

這裡是一些取自 ABI 的相關引文 [3](#fn:amd64-abi-prologue "See footnote") ：

> 在小型程式碼模型中，經由 AMD64 架構所提供的 IP 相對定址，所有的位址（包括 GOT 項目）都是可存取的，正因如此，不再需要明確的 GOT 指標，而用於設定該指標的 function prologue 也因此沒有必要了。但在中型與大型程式碼模型中，就必須配置一個暫存器用來持有位址無關目的檔（position-independent object）裡的 GOT 位址，這是因為 AMD64 ISA 並不支援大於 32 位元的立即位移值（immediate displacement）。

讓我們來看一下上面所展示的 prologue 是怎麼計算 GOT 位址的。首先，0x1e 的指令載入它本身的位址到 `rbx` 。然後一個 64 位元絕對數值搬移指令會在 `r11` 上完成，並附有一筆 `R_X86_64_GOTPC64` 重定位，該重定位表示：「取得 GOT 位址，減掉受重定位的偏移值，再加上加數」。最後，0x2f 的指令把兩者加在一起，最終結果就是 `rbx` [4](#fn:x86-64-got-pointer "See footnote") 裡面的 GOT 絕對位址 [〔7〕](#ref-7) 。

為什麼光是計算個 GOT 位址，就要搞得這麼麻煩呢？嗯，這是為了一件事，正如引文所述，在大型模型裡不能假設 32 位元相對偏移值一定足以存取 GOT，所以我們需要一個完全 64 位元的位址；另一方面，我們仍然想要 PIC，所以我們不能只是把絕對位址放進站存器，而要以相對於 RIP 的方式計算該位址，而這正是 prologue 所做的，它就只是一個 64 位元的 RIP 相對定址的計算。

無論如何，現在我們的 `rbx` 裡絕對有的 GOT 位址了，讓我們看看 `static_arr` 是怎麼被存取的：

```
t += static_arr[7];
69:       48 b8 00 00 00 00 00    movabs $0x0,%rax
70:       00 00 00
73:       8b 44 03 1c             mov    0x1c(%rbx,%rax,1),%eax
77:       01 45 ec                add    %eax,-0x14(%rbp)
```

第一個指令的重定位是 `R_X86_64_GOTOFF64` ，意指：「符號 + 加數 - GOT」，在我們的例子中：也就是 `static_arr` 位址跟 GOT 位址間的相對偏移值。而下個指令會再加上 `rbx` （GOT 的絕對位址），並配上偏移值 0x1c 來做解參考，這裡有某段虛擬 C 程式碼，讓計算更容易想像一點：

```
// char* static_arr
// char* GOT
rax = static_arr + 0 - GOT;  // rax 現在含有偏移值
eax = *(rbx + rax + 0x1c);   // rbx == GOT，所以 eax 現在含有
                             // *(GOT + static_arr - GOT + 0x1c) 或者說
                             // *(static_arr + 0x1c)
```

這裡有件有趣的事要注意：GOT 位址只是用來觸及 `static_arr` 的錨點（anchor），而不像 GOT 平常只是用來間接導向到實際包含在它裡面的符號位址，這是因為 `static_arr` 並非外部符號（external symbol），所以將它保存在 GOT *內部* 是沒有意義的。但儘管如此，GOT 在這裡仍然做為資料區段裡面的一個錨點來使用，並相對於某個以完全 64 位元偏移值能尋找到的符號位址，該偏移值同時仍保持著位址無關性（連結器將能解析這筆重定位，而讓載入時不需修改程式碼區段）。

那 `global_arr` 又如何呢？

```
t += global_arr[7];
55:       48 b8 00 00 00 00 00    movabs $0x0,%rax
5c:       00 00 00
5f:       48 8b 04 03             mov    (%rbx,%rax,1),%rax
63:       8b 40 1c                mov    0x1c(%rax),%eax
66:       01 45 ec                add    %eax,-0x14(%rbp)
```

程式碼有點長，而且重定位也不一樣了，這實際上是 GOT 的一個更傳統的使用方式， `movabs` 的 `R_X86_64_GOT64` 重定位只是說把 `global_arr` 位址落在 GOT 的位置的偏移值放進 `rax` ，0x5f 的指令從 GOT 取出 `global_arr` 位址並放進 `rax` ，而下個指令則解參考 `global_arr[7]` ，並把值放進 `eax` 。

現在來看看對 `global_func` 的程式碼參照，回想在大型程式碼模型中，不能對程式碼區段的大小做任何假設，所以我們需要假定，即使是要接觸 PLT 也會需要 64 位元的絕對位址：

```
int t = global_func(argc);
39: 8b 45 dc                mov    -0x24(%rbp),%eax
3c: 89 c7                   mov    %eax,%edi
3e: b8 00 00 00 00          mov    $0x0,%eax
43: 48 ba 00 00 00 00 00    movabs $0x0,%rdx
4a: 00 00 00
4d: 48 01 da                add    %rbx,%rdx
50: ff d2                   callq  *%rdx
52: 89 45 ec                mov    %eax,-0x14(%rbp)
```

相關重定位是 `R_X86_64_PLTOFF64` ，意指：「 `global_func` 的 PLT 項目位址，減去 GOT 位址」，這會放進 `rdx` ，稍後 `rbx` 會加進去的地方，因此最後結果是 `global_func` 的 PLT 項目位址會在 `rdx` 裡。

再次注意 `GOT` 的使用如同一個「錨點」，用來允許對 PLT 項目偏移值的位址無關形式的參照。

## 中型 PIC 程式碼模型（medium PIC code model）

在最後，我們將分析為了中型 PIC 程式碼模型生成的程式碼：

```
int main(int argc, const char* argv[])
{
  15:   55                      push   %rbp
  16:   48 89 e5                mov    %rsp,%rbp
  19:   53                      push   %rbx
  1a:   48 83 ec 28             sub    $0x28,%rsp
  1e:   48 8d 1d 00 00 00 00    lea    0x0(%rip),%rbx
  25:   89 7d dc                mov    %edi,-0x24(%rbp)
  28:   48 89 75 d0             mov    %rsi,-0x30(%rbp)
    int t = global_func(argc);
  2c:   8b 45 dc                mov    -0x24(%rbp),%eax
  2f:   89 c7                   mov    %eax,%edi
  31:   b8 00 00 00 00          mov    $0x0,%eax
  36:   e8 00 00 00 00          callq  3b <main+0x26>
  3b:   89 45 ec                mov    %eax,-0x14(%rbp)
    t += global_arr[7];
  3e:   48 8b 05 00 00 00 00    mov    0x0(%rip),%rax
  45:   8b 40 1c                mov    0x1c(%rax),%eax
  48:   01 45 ec                add    %eax,-0x14(%rbp)
    t += static_arr[7];
  4b:   8b 05 00 00 00 00       mov    0x0(%rip),%eax
  51:   01 45 ec                add    %eax,-0x14(%rbp)
    t += global_arr_big[7];
  54:   48 8b 05 00 00 00 00    mov    0x0(%rip),%rax
  5b:   8b 40 1c                mov    0x1c(%rax),%eax
  5e:   01 45 ec                add    %eax,-0x14(%rbp)
    t += static_arr_big[7];
  61:   48 b8 00 00 00 00 00    movabs $0x0,%rax
  68:   00 00 00
  6b:   8b 44 03 1c             mov    0x1c(%rbx,%rax,1),%eax
  6f:   01 45 ec                add    %eax,-0x14(%rbp)
    return t;
  72:   8b 45 ec                mov    -0x14(%rbp),%eax
}
  75:   48 83 c4 28             add    $0x28,%rsp
  79:   5b                      pop    %rbx
  7a:   c9                      leaveq
  7b:   c3                      retq
```

以及重定位：

```
Relocation section '.rela.text' at offset 0x62d60 contains 6 entries:
  Offset          Info           Type           Sym. Value    Sym. Name + Addend
000000000021  00160000001a R_X86_64_GOTPC32  0000000000000000 _GLOBAL_OFFSET_TABLE_ - 4
000000000037  001700000004 R_X86_64_PLT32    0000000000000000 global_func - 4
000000000041  001200000009 R_X86_64_GOTPCREL 0000000000000000 global_arr - 4
00000000004d  000300000002 R_X86_64_PC32     0000000000000000 .data + 1b8
000000000057  001300000009 R_X86_64_GOTPCREL 0000000000000000 global_arr_big - 4
000000000063  000a00000019 R_X86_64_GOTOFF64 0000000000030d40 static_arr_big + 0
```

首先，先把函式呼叫排除掉，因為與小型模型相似，在中等模型中，我們假設程式碼參照會落在相對於 RIP 的 32 位元偏移值界線內，因此對 `global_func` 的呼叫跟小型 PIC 模型是完全同樣的，這個情況也適用於小型資料陣列 `static_arr` 與 `global_arr` 。所以我們將專注在大型資料陣列，不過，我們先來討論一下 prologue，它跟大型模型不一樣：

```
1e:   48 8d 1d 00 00 00 00    lea    0x0(%rip),%rbx
```

就只有這樣，單一個指令（而不是像大型模型中要用三個）把 GOT 位址放進 `rbx` （在 `R_X86_64_GOTPC32` 重定位的輔助下），為什麼會有差異呢？由於在中型程式碼模型裡，我們假設 GOT 本身是用 32 位元偏移值就碰的到的，這是因為 GOT 並不是「大型資料區段」的一部分；而在大型程式碼模型哩，我們不能做這個假設，而必須使用完全 64 位元的偏移值來存取 GOT。

有趣的是，我們注意到 `global_arr_big` 的程式碼也跟小型 PIC 模型相似，為什麼呢？因為某些緣故，prologue 比在大型模型裡的更短一點，在中型模型裡面，我們假設 GOT 本身是用 32 位元 RIP 相對定址就碰的到了，當然 `global_arr_big` 本身是不行的，但無論怎麼樣，這都是由 GOT 去涵蓋的，因為 `global_arr_big` 位址實際上是落在 GOT 裡面，而且在那裡它就會是個完全 64 位元的位址了。

然而，對於 `static_arr_big` ，情況不太一樣：

```
t += static_arr_big[7];
61:   48 b8 00 00 00 00 00    movabs $0x0,%rax
68:   00 00 00
6b:   8b 44 03 1c             mov    0x1c(%rbx,%rax,1),%eax
6f:   01 45 ec                add    %eax,-0x14(%rbp)
```

這實際上類似於大型 PIC 程式碼模型，因為在這裡我們要去獲取的是，不落在 GOT 裡的符號的絕對位址，由於這是大型符號，不能假設會落在低位的 2 GB 裡，所以在這裡我們需要 64 位元 PIC 偏移值，與大型模型的情況類似。

---

[〔1〕](#cite-1)

不要把程式碼模型跟 [64 位元資料模型（64-bit data model）](https://en.wikipedia.org/wiki/64-bit_computing#64-bit_data_models) 和 [Intel 記憶體模型（Intel memory model）](https://en.wikipedia.org/wiki/Intel_Memory_Model) 搞混了，這兩者都是不同的主題。

[〔2〕](#cite-2)

有一件重要的事要銘記在心：實際的指令是由編譯器產生的，並且在該階段就把定址模式「黏死」了，但編譯器沒有辦法知道它正在編譯的目的檔，最終會產出哪些程式或共享函式庫，有些也許是小型的，但有些可能是大型的。雖然連結器確實知道產出的程式大小，但那時候已經太遲了，因為連結器不能真的改變指令，只能依靠重定位項目（relocation）來修補偏移值。正因如此，程式碼模型的「合約」必須由程式撰寫者在編譯階段「簽下」。

[〔3〕](#cite-3)

如果這樣還不太清楚，去讀一下 [這篇文章吧。](https://alittleresearcher.blogspot.tw/2017/01/load-time-relocation-of-shared-libraries.html)

[〔4〕](#cite-4)

雖然話是這麼說，在我最後一次確認的時候，Clang 的 Debug+Asserts 建置幾乎有 0.5 GB 的大小（由於有相當不少自動生成的程式碼）。

[〔5〕](#cite-5)

除非你已經了解 PIC 是怎麼運作的（包括一般狀況跟特定於 x64 之下），否則這會是一個好時機，去看看我早前在這個主題上的文章—— [#1](https://alittleresearcher.blogspot.tw/2017/03/position-independent-code-pic-in-shared-libraries.html) 和 [#2](https://alittleresearcher.blogspot.tw/2017/03/position-independent-code-pic-in-shared-libraries-on-x64.html) 。

[〔6〕](#cite-6)

所以連結器無法只靠自己就完全解析那些參照，而需要把處置 GOT 這件事交給動態載入器。

[〔7〕](#cite-7)

0x25 - 0x7 + GOT - 0x27 + 0x9 = GOT

[^1]: 在 Linux Foundation 的網站中，也 [收集](https://refspecs.linuxfoundation.org/) 了一些 Linux 所參照的標準，其中的「System V Application Binary Interface x86-64 Architecture Processor Supplement」標準，就有相關於程式碼模型的規範，它就是本文從官方網站參考的標準。

[^2]: 可見性（visibility）和範圍（scope）在程式語言中 [有相近的意義](https://en.wikipedia.org/wiki/Scope_%28computer_science%29) 。

[^3]: 這段引文應該是取自 SysV x86-64 psABI（詳見譯註 1），在該文件版本 Draft 0.99.6 中，小節名稱為〈Position-Independent Function Prologue〉，其內容純粹用於 PIC 程式碼，對非 PIC 的目的檔不一定適用。

[^4]: 然而，同樣根據引文所參考的資料，在其中還提到了除了某些可以讓編譯器自由發揮的情況，GOT 基底位址應該保存於 `r15` 而非 `rbx` ，而為何 GCC 採取此項做法，雖然在 mailing list 中曾有人 [提起](https://gcc.gnu.org/ml/gcc/2014-11/msg00161.html) ，但似乎找不到準確的回應。