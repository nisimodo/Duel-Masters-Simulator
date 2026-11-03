# デュエマ オンライン

友達同士で遊ぶデュエル・マスターズの非公開対戦サイト (React + Vite、GitHub Pages + Firebase)。画面の文字・コメントは日本語。

## デッキコード (`DM1…`)

ユーザーが `DM1` で始まる文字列を貼ったら、それはこのサイトのデッキコード。中身を見る・対戦させるには:

```bash
node scripts/deck-code.mjs <コード>          # デッキ名・カード名・枚数・カードIDを表示
node scripts/deck-code.mjs --json <コード>   # アプリの Deck の形の JSON
node scripts/deck-code.mjs encode <file.json>  # {t,n,m,h?,g?,p?,s?} (カードIDかカード名) からコードを作る
DECKS="<コード> <コード>" GAMES=50 npx vitest run src/lib/deckCode.sim.test.ts   # CPU同士で対戦 (2〜4個、MODE=modoki も可)
```

- 対戦の結果は画面のほか `deck-sim-report.txt` (OUT で変更) にも出る。「うまく処理できなかった効果」はルールエンジンの未対応の手がかり。
- 形式: `DM1` + base64url(deflate-raw(JSON))。JSON = `{ t: 'duema'|'duepa', n: 名前, m: [[カードID, 枚数], …], h?: 超次元, g?: 超GR, p?: パートナー, s?: サムネイル }`。実装は `src/lib/deckCode.ts` (テスト `deckCode.test.ts`)。
- カードIDは `public/data/cards.json` の `id`。
