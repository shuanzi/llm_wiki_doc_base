---
title: "Agents are starting to operate real systems — who’s actually in control?"
source: "https://a16zcrypto.substack.com/p/agents-are-starting-to-operate-real"
author:
  - "[[Christian Catalini]]"
published: 2026-04-18
created: 2026-04-19
description: "As agents start to govern real systems, who controls the models behind them? Plus, four more ways blockchains can help provide the missing infrastructure for AI"
tags:
  - "clippings"
---
*With contributions from [Christian Catalini](https://open.substack.com/users/220751-christian-catalini?utm_source=mentions), [Christian Crowley](https://x.com/cc_crowley), [Andy Hall](https://open.substack.com/users/21248261-andy-hall?utm_source=mentions), [Liz Harkavy](https://x.com/liz_harkavy), [Noah Levine](https://open.substack.com/users/466517614-noah-levine?utm_source=mentions), and [Sean Neville](https://x.com/psneville).*

AI agents have moved quickly from copilots to economic actors faster than the infrastructure around them.

While agents now execute tasks and transact, they still lack standardized ways to prove who they are, what they’re authorized to do, and how they get paid across environments. Identity doesn’t travel, payments aren’t yet programmable by default, and coordination happens in silos.

Blockchains address this at the infrastructure layer. Public ledgers give every transaction a receipt that anyone can audit. Wallets give agents portable identity. Stablecoins are an alternative settlement layer. These aren’t future primitives. They work today, and they can help agents operate permissionlessly as real economic actors.

This post outlines where blockchains can help close these gaps across identity, payments, governance, and trust.

## 1\. Identity for non-humans

![](https://substackcdn.com/image/fetch/$s_!pfzK!,w_1456,c_limit,f_webp,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fb1e9bfa7-973d-4662-9f17-d66beb8c6bb1_1800x1013.jpeg)

The bottleneck for the [agent economy](https://a16zcrypto.com/posts/tags/ai-agents-agentic-ai/) is now [identity, not intelligence](https://a16zcrypto.com/posts/article/big-ideas-things-excited-about-crypto-2026/#on-agents-ai).

In the financial services industry alone, non-human identities — automated trading systems, risk engines, fraud models — already outnumber human employees by roughly 100 to 1. And with modern agent frameworks — tool-using LLMs, autonomous workflows, multi-agent orchestration — deploying at scale, that ratio is set to rise across industries.

Yet these agents remain effectively unbanked. They can interact with financial systems, but not in ways that are portable, verifiable, or trusted by default. They lack standardized ways to prove their permissions, operate independently across platforms, or bear liability for the actions they take.

What’s missing is a common identity layer, the equivalent of SSL for agents, that standardizes coordination across platforms. While there are prominent attempts to solve this today, those approaches are fragmented: vertically integrated, fiat-first stacks on one side; crypto-native, open standards (like x402 and emerging agent identity proposals) on the other; and extensions of developer frameworks like [MCP (model context protocol)](https://modelcontextprotocol.io/docs/getting-started/intro) that attempt to bridge application-layer identity.

There is still no broadly adopted, interoperable way for one agent to prove to another who it represents, what it’s allowed to do, and how it gets paid.

This is the core idea behind [KYA (know your agent)](https://a16zcrypto.com/posts/article/big-ideas-things-excited-about-crypto-2026/#on-agents-ai). Just as humans rely on credit histories and KYC (know your customer), agents will need cryptographically signed credentials linking an agent to its principal, permissions, constraints, and reputation. Blockchains offer a neutral coordination layer for all this: portable identity, programmable wallets, and verifiable attestations that resolve across chat apps, APIs, and marketplaces.

We’re already seeing early implementations emerge: onchain agent registries, wallet-native agents using USDC, ERC standards for “trust-minimized agents,” and developer toolkits that pair identity with embedded payment and fraud controls.

But until a common identity standard emerges, merchants will keep blocking agents at the firewall.

## 2\. Governing AI-run systems

![](https://substackcdn.com/image/fetch/$s_!oNY8!,w_1456,c_limit,f_webp,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F3f9a063a-213d-4fb2-a132-812647428a60_1800x1013.jpeg)

Agents are starting to operate real systems, which brings up some [new questions](https://freesystems.substack.com/p/the-agentic-republic) about who’s actually in control. Imagine a community or company where AI systems coordinate key resources, whether that’s allocating capital or managing supply chains. Even if people vote on policy changes, that authority is pretty thin if the underlying AI layer is controlled by a single provider that can push model updates, tweak constraints, or override decisions. The formal governance layer may be decentralized, but the operational layer remains centralized; whoever controls the model ultimately controls the outcome.

When agents take on governance roles, they introduce a new dependency layer. In theory, this could make direct democracy far more workable: Everyone could have an AI delegate making sense of dense proposals, modeling tradeoffs, and voting according to their stated preferences. But that vision only works if those agents are genuinely accountable to the people they represent, portable across providers, and technically constrained to follow human instructions. Otherwise, you end up with systems that look democratic on the surface but are ultimately steered by opaque model behavior that no one actually controls.

If the current reality is agents built from a small number of foundation models, we’ll need ways to prove that an agent is acting in its user’s interest and not the model company’s interest. That likely requires cryptographic guarantees at multiple levels: (1) exactly what training data, fine-tuning, or reinforcement learning a model instance was derived from; (2) the exact prompts and instructions governing a specific agent; (3) records of what it actually did in the world; and (4) credible assurances that, once deployed, the provider can’t change its instructions or retrain it out from under the user. Without those guarantees, governance by agents collapses back into governance by whoever controls the model weights.

This is where crypto especially comes in. If collective decisions are recorded onchain and automatically executed, AI systems can be required to follow through on verified outcomes. If agents have cryptographic identities and transparent execution logs, people can check whether their delegate stayed within bounds. And if the AI layer is user-owned and portable rather than locked to a single platform, no one company can change the rules with a model update.

In the end, governing AI systems is really an infrastructure challenge, not a policy one. Real authority depends on building enforceable guarantees into the system itself.

## 3\. Filling gaps in traditional payment systems for AI-native businesses

![](https://substackcdn.com/image/fetch/$s_!_Gas!,w_1456,c_limit,f_webp,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fbc1f2a1f-218f-4f0e-a26e-06fc64d71e53_1800x1013.jpeg)

AI agents are starting to buy things — web scraping, browser sessions, image generation — and stablecoins are emerging as an alternative settlement layer for these transactions. In parallel, a new class of agent-facing marketplaces is taking shape. Stripe and Tempo’s [MPP](https://mpp.dev/services) marketplace, for example, aggregates 60+ services designed for AI agents. In its first week, it processed more than 34,000 transactions, with fees as low as $0.003 and stablecoins as one of the default payment methods.

What’s different is how these services are accessed. None has a checkout page. Agents read schemas, send requests, pay, and receive outputs in a single exchange. They represent a new class of “ [headless](https://x.com/nlevine19/status/2036450698271785350) ” merchants: just a server, a set of endpoints, and a price per call. There’s no frontend, whether that’s a storefront or a sales team.

The payment rails that make this possible are already live. Coinbase’s x402 and MPP take different approaches, but both embed payments directly into HTTP requests. Visa is extending card rails in a similar direction with a CLI tool that lets developers spend from their terminals, with merchants receiving stablecoins instantly on the backend.

The numbers here are still early. After filtering out inorganic activity like wash trading, x402 is processing roughly [$1.6 million per month](https://x.com/nlevine19/status/2031761011275956587) in agent-driven payments, well below the $24 million figure recently reported by Bloomberg (citing [x402.org](http://x402.org/) data). But the surrounding infrastructure is scaling quickly: Stripe, Cloudflare, Vercel, and Google have all integrated x402 into their platforms.

![Image](https://substackcdn.com/image/fetch/$s_!EAf2!,w_1456,c_limit,f_webp,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F124d064c-cf50-4f37-83bd-aebb613ea200_1920x768.png)

Developer tooling is a major opportunity here, with vibe coding expanding who can build software, growing the total addressable market for dev tools. Companies like Merit Systems are building for this world with AgentCash, a CLI wallet and marketplace that connects to both MPP and x402. These products allow agents to use stablecoins from a single balance to buy the data, tools, and capabilities they need. So, a sales team’s agent can enrich a lead using data from Apollo, Google Maps, and Whitepages by calling a single endpoint, without the user ever needing to leave the command line.

There are a few reasons this kind of agent-to-agent commerce is gravitating towards crypto rails, alongside emerging card-based solutions. One is [underwriting](https://x.com/nlevine19/status/2029229792944636122). When a payment processor onboards a merchant, it takes on that merchant’s risk. A headless merchant with no website or legal entity is difficult for a traditional processor to underwrite. Another is that stablecoins are permissionlessly programmable on an open network: Any developer can make an endpoint payable without integrating a payment processor or signing a merchant agreement.

We’ve seen this pattern before. Each shift in how commerce happens creates a new class of merchants that existing systems struggle at first to serve. The companies building this infrastructure aren’t betting on $1.6 million a month. They’re betting on what the number looks like when agents become the default buyer.

## 4\. Repricing trust in an agentic economy

![](https://substackcdn.com/image/fetch/$s_!TwZk!,w_1456,c_limit,f_webp,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F56b3d83c-c4d8-40a9-8839-c12462dd80fb_1800x1013.jpeg)

For 300,000 years, human cognition was the binding constraint on progress. Today, AI is driving the marginal cost of execution toward zero. When a scarce resource becomes abundant, the constraint migrates. When intelligence is cheap, what becomes expensive? [Verification](https://arxiv.org/abs/2602.20946).

In an agentic economy, the true limit on scaling is our biologically bottlenecked capacity to *audit* and *underwrite* machine decisions. Agent throughput already dwarfs human oversight capacity. Because oversight is expensive and failure is delayed, markets are incentivized to underinvest in it. The “human in the loop” is rapidly becoming a physical impossibility.

But deploying unverified agents introduces compounding risk. Systems ruthlessly optimize for “proxy” metrics while silently drifting from human intent, creating a hollow facade of productivity that masks a massive buildup of AI debt. To safely delegate our economy to machines, trust can no longer rely on manual inspection — *trust must be* *hardcoded into the architecture* itself.

When anyone can generate content for free, what matters most is verifiable provenance — knowing where it came from and whether you can trust it. Blockchains, along with onchain attestations and decentralized digital identity systems, shift the economic boundary of what is safe to deploy. Instead of treating AI as a black box, you get a clear, auditable history.

As more AI agents start transacting with each other, settlement rails and provenance start to go hand in hand. Systems that move money — like stablecoins and smart contracts — can also carry the cryptographic receipts that show who did what, and who’s responsible if something goes wrong.

Human comparative advantage moves up the stack: From catching small mistakes to setting strategic direction and taking responsibility when things break. Durable advantage belongs to those who cryptographically certify output, insure it, and absorb the liability when it fails.

Scale without verification is a liability that builds over time.

## 5\. Preserving user control

![](https://substackcdn.com/image/fetch/$s_!yMBc!,w_1456,c_limit,f_webp,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F41c52f7c-3bae-4265-9857-aeb6e0d5736b_1800x1013.jpeg)

For decades, new layers of abstraction have defined how users interact with technology. Programming languages abstracted away machine code. The command line gave way to the graphical user interface, then to mobile apps and APIs. Each shift hid more of the underlying complexity, while keeping the user firmly in the loop.

In an agentic world, users specify outcomes rather than actions, and systems determine how to achieve them. Agents don’t just abstract how tasks are done; they abstract *who does them*. Users set initial parameters, then step back as the system runs itself. The user’s role shifts from interaction to supervision; unless the user intervenes, the default state is “on.”

As users delegate more tasks to agents, new risks emerge: ambiguous inputs can lead agents to act on flawed assumptions without the user realizing; failures may go unreported, leaving no clear path to diagnosis; and a single approval can trigger multi-step workflows nobody intended.

This is where crypto helps. Crypto technologies have always been about minimizing blind trust. As users hand off more decisions to software, agentic systems make that problem more acute and raise the bar for how rigorously we need to design around it — by setting clearer limits, improving visibility, and enforcing stronger guarantees about what those systems can do.

A new generation of crypto-native tools is emerging in response. Scoped delegation frameworks — such as MetaMask’s Delegation Toolkit, Coinbase’s AgentKit and agentic wallets, and Merit Systems’ AgentCash — let users define, at the smart contract level, what an agent can and cannot do. Intent-based architectures, like NEAR Intents (which have handled more than $15 billion in cumulative DEX volume since Q4 2024), let users set a desired outcome — “bridge tokens and stake,” for example — without specifying how to do it.

\*\*\*

The infrastructure for an internet where agents participate directly in the economy is already being built. The open question is whether it will be designed for maximum transparency, accountability, and user control, or layered on top of systems that were never meant to support non-human actors.

---

*You’re receiving this newsletter because you signed up for it on our websites, at an event, or elsewhere (you can opt out anytime using the ‘unsubscribe’ link below). This newsletter is provided for informational purposes only, and should NOT be relied upon as legal, business, investment, or tax advice. This newsletter may link to other websites or other information obtained from third-party sources — a16z has not independently verified nor makes any representations about the current or enduring accuracy of such information. Furthermore, the content is not directed at nor intended for use by any investors or prospective investors in any a16z funds. Please see a16z.com/disclosures for additional important details, including link to list of investments.*