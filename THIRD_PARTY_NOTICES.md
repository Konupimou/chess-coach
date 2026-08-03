# Third-party notices

## RhosGFX chess pieces

- Asset: **RhosGFX chess piece set**
- Author: RhosGFX
- Source: https://github.com/lichess-org/lila/tree/master/public/piece/rhosgfx
- Pinned Lichess commit: `32b4f7a57a006702d22015b01b1fa1dd97239513`
- Imported: 3 August 2026
- License: CC0 1.0 Universal

The 12 unchanged SVG piece files are stored in `public/libs/img/rhosgfx`.
The Lichess source repository identifies this set as CC0 and links the original
author at https://rhosgfx.itch.io/.

## Lichess Chess Openings

- Dataset: **Chess opening names**
- Authors: Lichess contributors
- Source: https://github.com/lichess-org/chess-openings
- Pinned commit: `51b886249b9e418498d25b6e39b926c3de99c29a`
- Source date: 22 July 2026
- License: CC0 1.0 Universal

The checked-in source files `a.tsv` through `e.tsv` and the generated local
runtime index are derived from this dataset. The complete CC0 legal text is
included at `data/openings/source/COPYING.txt`.

## Lichess Puzzle Database

- Dataset: **Lichess puzzle database**
- Authors: Lichess contributors
- Source: https://database.lichess.org/#puzzles
- Imported from: https://database.lichess.org/lichess_db_puzzle.csv.zst
- Import date: 1 August 2026
- License: CC0 1.0 Universal

The generated file `data/knowledge/lichess-puzzles-800.json` contains 7,394
filtered and anonymised training records derived from 6,057,356 source rows.
It keeps only the training position, solution moves, rating, selected themes
and a newly generated technical hash. Upstream puzzle IDs, game URLs, opening
tags, player names and source-game attribution are discarded. The compressed
source database is streamed during import and is not stored in this repository.

The selection and reproducible import command are documented in
`docs/open-knowledge-research.md`.

## fzstd

- Package: **fzstd** 0.1.1
- Source: https://www.npmjs.com/package/fzstd
- License: MIT

The import script uses `fzstd` to stream the concatenated and skippable Zstandard
frames published by Lichess. It is a development-time import dependency and is
not used to generate chess claims.
