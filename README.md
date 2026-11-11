# Google Gemini 4 Carbon vs Anthropic Claude Fable 5.2: race, voxel diorama, channel intro

Two top models, the same short prompts, one prompt per test, no fixes. Each model runs in its own native harness and writes, runs and checks its own work. Final score **2 : 1 for Carbon** (race and diorama to Carbon, the intro to Fable).

**▶ Play in your browser:** https://kostikoneuro.github.io/gemini-carbon-vs-fable-5-2/ (English / [русский](https://kostikoneuro.github.io/gemini-carbon-vs-fable-5-2/?lang=ru))
**🎬 Video (Russian):** coming soon
**💬 Telegram:** https://t.me/kostik_neuro

> Русский: страница на русском: https://kostikoneuro.github.io/gemini-carbon-vs-fable-5-2/?lang=ru. Все игры и диорамы открываются прямо в браузере, в каждой есть кнопка «← Ко всем тестам». Промпты в папке [`prompts/`](prompts/).

## The tests

| # | Test | Gemini 4 Carbon | Claude Fable 5.2 | Round |
|---|---|---|---|---|
| 1 | **Neon Night Racer**: 80s arcade racer in the browser, music and sound in code | [play](1-race/carbon/) | [play](1-race/fable/) | Carbon |
| 2 | **Night market voxel diorama** in Shenzhen after the rain: 30-second fly-through on open, `C` = free camera. Shown blind in the video: "Variant 1" = Carbon, "Variant 2" = Fable | [open](2-diorama/carbon/) | [open](2-diorama/fable/) | Carbon |
| 3 | **Channel intro**: 10 s, the model studies the channel by itself and makes the intro in [OpenMontage](https://github.com/calesthio/OpenMontage); paid generation only via kie.ai, $1 cap | [video](3-intro/carbon.mp4) | [video](3-intro/fable.mp4) | Fable (the channel's new intro) |

Controls in the race: Carbon: A/D or ←/→ steer, W throttle, S brake, **Space / Shift** = hyper-turbo, C = camera, M = sound, R = retry, Space = start. Fable: ←/→ or A/D steer, ↓ brake, **Space** = overdrive, Enter = start, P = pause, M = sound.

Diorama: Carbon: C = free camera (mouse + WASD, Q/E). Fable: C = free camera (mouse), Space = pause the world.

The exact prompts (Russian, short on purpose) are in [`prompts/`](prompts/), with English translations in [`prompts/en/`](prompts/en/). The only change I made to the models' code is a small "← All tests" link in the top-left corner of each game and diorama.

## Time and cost

Official list prices per 1M tokens: Carbon $2 in / $0.10 cache / $10 out (introductory price until Nov 30, doubles from Dec 1); Fable 5.2 $8 in / $0.20 cache / $40 out. Token counts come from the session logs.

| Test | Gemini 4 Carbon | Claude Fable 5.2 |
|---|---|---|
| 1 Race | 25 min · $1.76 (+ up to $0.54 helper) | 43 min · $13.71 |
| 2 Diorama | 57 min · $2.81 (+ up to $3.49 helper) | 43 min · $12.44 |
| 3 Intro | 44 min · $2.97 (+ up to $0.79 helper) + kie $0.50 | 38 min · $15.56 + kie $0.06 |
| **Total** | **~2 h 07 min · $7.54** (up to $12.36 with the helper) + kie $0.50 | **~2 h 05 min · $41.71** + kie $0.06 |

"Helper": Antigravity starts its own browser subagent on Gemini 3.8 Flash to play the game, watch the fly-through and open the channel. I priced it at Carbon's rates, so it is an upper bound; at Flash prices it is several times cheaper.

## How it was run

- **Gemini 4 Carbon**: Google's **Antigravity** app, thinking **High** (the maximum Antigravity offers). I ran it by hand, a new conversation per test, pasting the same prompt.
- **Claude Fable 5.2**: **Claude Code** 2.1.321, effort **High**, with a headless Playwright browser so the model can play and look at its own work. A new session per test in a clean folder.
- One prompt per test, at most one fix in words. Neither model needed a fix, and neither stopped to ask for approval.
- The models did not see the scoring criteria. The diorama was judged blind in the video.
- Test 3 (intro): OpenMontage, paid generation only through kie.ai with a $1 cap. Carbon spent $0.50 (2 images, a Kling video, Suno music); Fable spent $0.06 (one Suno track) and drew all the graphics in code. Fable's nerd hamster became the channel's new intro ("Король заставки").
- Carbon's first speedrun attempt broke three times on a network timeout (`The stream was interrupted`) before writing any files and cost $0.68; it is not in the table. The run above is the clean one.
