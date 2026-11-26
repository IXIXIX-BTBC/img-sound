# NOTICE / 権利表示

## Source code / ソースコード
`index.html`, `css/`, `js/`, `pixel/`, `lead/`, `bass/`, `dub/` — PolyForm Noncommercial License 1.0.0, with an additional permission to use what you make commercially (see [LICENSE](LICENSE) and [COMMERCIAL.md](COMMERCIAL.md)).
Copyright (c) 2026 IXIXIX from BTBC & HIDEYA KUMAGAI

## Logo / ロゴ
`img/logo.svg`
Copyright (c) 2026 IXIXIX from BTBC & HIDEYA KUMAGAI. All rights reserved.

- You may use it as part of this app, including in a modified version of the app.
- Do not use it separately (for example as a logo of something else, in merchandise, or in other products) without permission.
- このアプリの一部として使う(アプリをそのまま・改造して動かす)ことはできます。改造版でもそのまま使えます。
- アプリから切り離しての利用(ほかのもののロゴとして使う、グッズや他の作品に使う など)は、許可なくしないでください。

## Modified versions / 改造版を配るとき
If you redistribute a modified version (for free — see [COMMERCIAL.md](COMMERCIAL.md)):
- **Add your own name before or after "IMG SOUND"**, in the logo and the app name, so people can tell it apart from the original. Examples: "XYZ IMG SOUND", "IMG SOUND XYZ".
- Keep the copyright notice and the LICENSE, and say that it is based on IMG SOUND (with a link to https://github.com/IXIXIX-BTBC/img-sound).

改造版を配る場合(無料に限ります。[COMMERCIAL.md](COMMERCIAL.md)):
- 本家と区別できるよう、**ロゴとアプリ名の「IMG SOUND」の前か後ろに、独自の名前を付けてください**。例:「XYZ IMG SOUND」「IMG SOUND XYZ」
- 著作権表示と LICENSE を残し、IMG SOUND をもとにしていることを書いてください(https://github.com/IXIXIX-BTBC/img-sound へのリンク付き)。

## Visual design / 画面のデザイン
The screen design (layout, icons and color scheme) is an original work by the authors and is part of the software covered by the LICENSE. It may not be used commercially outside the terms of the LICENSE.
画面のデザイン(配置・アイコン・配色)も作者の創作物で、LICENSE の対象に含まれます。LICENSE の範囲を超えた商用利用はできません。

## Sound design / 音の作り
The tape echo and the tube compressor are our own models, made by studying how classic studio equipment works. They are not copies of, and not endorsed by, any manufacturer.
テープエコーと真空管コンプは、昔のスタジオ機材の仕組みを調べて作った独自のモデルです。特定のメーカーの製品を複製したものではなく、メーカーとは関係ありません。

## Fonts / フォント
- `fonts/Poppins-Regular-latin.woff2`, `fonts/Poppins-Bold-latin.woff2` — Poppins, Copyright 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins). SIL Open Font License, Version 1.1 ([fonts/OFL-Poppins.txt](fonts/OFL-Poppins.txt)).
- `fonts/Syne-Regular.ttf`, `fonts/Syne-Bold.ttf` — Syne, Copyright 2017 The Syne Project Authors (https://gitlab.com/bonjour-monde/fonderie/syne-typeface). SIL Open Font License, Version 1.1 ([fonts/OFL-Syne.txt](fonts/OFL-Syne.txt)).

## HEIC decoder / HEIC の読み込み部品
`vendor/heic-to/heic-to.min.js` — heic-to 1.6.7 (https://github.com/hoppergee/heic-to), which contains libheif (https://github.com/strukturag/libheif) compiled to WebAssembly.
GNU Lesser General Public License v3.0 ([vendor/heic-to/LICENSE](vendor/heic-to/LICENSE), with the GNU General Public License v3.0 it refers to: [vendor/heic-to/GPL-3.0.txt](vendor/heic-to/GPL-3.0.txt)).
It is used unchanged, as a separate file that the app loads only when a HEIC photo is added. You may replace it with another (for example a newer or a modified) build of heic-to that has the same interface. Its source code is available at the links above.

iPhone の写真(HEIC)を読み込むための部品です。LGPL v3.0 のもと、変更せずに別ファイルのまま同梱しています(HEIC の写真を入れたときだけ読み込みます)。同じ使い方ができる別の版(新しい版・改造した版)に差し替えることができます。ソースコードは上のリンク先で手に入ります。
