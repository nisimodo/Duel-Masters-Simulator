// みんなのデッキ: 投稿されたデッキを絞り込んで探し、自分のデッキにインポートする
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context';
import { importSharedDeck, subscribeShared, type SharedDeck } from '../data/api';
import { CIV_COLOR, CIV_NAME, type CardDB, type Civ } from '../lib/cards';
import { DEFAULT_RULES, deckCivs, deckFormat, validateDeck, type Deck } from '../lib/deck';
import { DeckSection, DeckTile } from '../components/DeckGrid';
import { nameMatches } from '../lib/search';

type CivKey = Civ | 'Z';
const CIVS: CivKey[] = ['L', 'W', 'D', 'F', 'N', 'Z'];
const civLabel = (c: CivKey) => (c === 'Z' ? '無色' : CIV_NAME[c]);
const civColor = (c: CivKey) => (c === 'Z' ? '#9aa0b8' : CIV_COLOR[c]);

type Kind = 'original' | 'advance' | 'duepa';
const KIND_LABEL: Record<Kind, string> = { original: 'オリジナル', advance: 'アドバンス', duepa: 'デュエパ' };
type Hof = 'all' | 'zero' | 'normalOnly';

/** デッキに入っているカード (メイン・超次元・GR・パートナー) の id */
const cardIds = (d: Deck) => [...Object.keys(d.main), ...Object.keys(d.hyper), ...Object.keys(d.gr), ...(d.partner ? [d.partner] : [])];

/** 絞り込みに使う、デッキごとの情報 (投稿が変わった時だけ作り直す) */
interface Info {
  s: SharedDeck;
  names: Set<string>;
  civs: Set<CivKey>;
  kind: Kind;
  zeroOk: boolean;
  normalOk: boolean;
}

function infoOf(db: CardDB, s: SharedDeck): Info {
  const d = s.deck;
  const names = new Set<string>();
  let colorless = false;
  for (const id of cardIds(d)) {
    const c = db.byId.get(id);
    if (!c) continue;
    names.add(c.name);
    for (const f of c.faces) names.add(f.name);
    if (!c.civs.length) colorless = true;
  }
  const civs = new Set<CivKey>(deckCivs(db, d));
  if (colorless) civs.add('Z');
  const kind: Kind = d.type === 'duepa' ? 'duepa' : deckFormat(db, d) === 'original' ? 'original' : 'advance';
  const rules = DEFAULT_RULES[d.type];
  return { s, names, civs, kind, zeroOk: validateDeck(db, d, { ...rules, hof: 'zero' }).length === 0, normalOk: validateDeck(db, d, rules).length === 0 };
}

export default function SharedDecks() {
  const { user, db } = useApp();
  const nav = useNavigate();
  const [shared, setShared] = useState<SharedDeck[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [text, setText] = useState('');
  const [cards, setCards] = useState<string[]>([]);
  const [cardQ, setCardQ] = useState('');
  const [useCivs, setUseCivs] = useState<CivKey[]>([]);
  const [noCivs, setNoCivs] = useState<CivKey[]>([]);
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [hof, setHof] = useState<Hof>('all');
  useEffect(
    () =>
      user
        ? subscribeShared(
            (v) => {
              setShared(v);
              setLoadError(null);
            },
            (e) => setLoadError(e.message || String(e)),
          )
        : undefined,
    [user],
  );
  const infos = useMemo(() => (db && shared ? shared.map((s) => infoOf(db, s)) : []), [db, shared]);
  // カード名の候補 (名前・読みの一部で検索)
  const suggest = useMemo(() => {
    const k = cardQ.trim();
    if (!db || !k) return [];
    const out = new Set<string>();
    for (const c of db.cards) {
      if (nameMatches(c, k)) out.add(c.name);
      if (out.size >= 30) break;
    }
    return [...out].filter((n) => !cards.includes(n));
  }, [db, cardQ, cards]);
  if (!db || !user) return null;

  const toggle = <T,>(list: T[], set: (v: T[]) => void, v: T) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const q = text.trim().toLowerCase();
  const hits = infos.filter(
    (x) =>
      (!q || x.s.deck.name.toLowerCase().includes(q) || x.s.owner.toLowerCase().includes(q)) &&
      cards.every((n) => x.names.has(n)) &&
      useCivs.every((c) => x.civs.has(c)) &&
      noCivs.every((c) => !x.civs.has(c)) &&
      (!kinds.length || kinds.includes(x.kind)) &&
      (hof === 'all' || (hof === 'zero' ? x.zeroOk : x.normalOk && !x.zeroOk)),
  );
  const filtered = !!(q || cards.length || useCivs.length || noCivs.length || kinds.length || hof !== 'all');
  const clear = () => {
    setText('');
    setCards([]);
    setCardQ('');
    setUseCivs([]);
    setNoCivs([]);
    setKinds([]);
    setHof('all');
  };

  const importOne = async (s: SharedDeck) => {
    await importSharedDeck(user.uid, s);
    setMsg(`「${s.deck.name}」(${s.owner} さんのデッキ) を自分のデッキにインポートしました`);
  };

  const civToggles = (list: CivKey[], set: (v: CivKey[]) => void, other: CivKey[]) => (
    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      {CIVS.map((c) => (
        <button key={c} className={`small chip${list.includes(c) ? ' primary' : ''}`} disabled={other.includes(c)} aria-pressed={list.includes(c)} onClick={() => toggle(list, set, c)}>
          <span className="civdot" style={{ background: civColor(c) }} /> {civLabel(c)}
        </button>
      ))}
    </div>
  );

  return (
    <div className="page col">
      <h2>みんなのデッキ</h2>
      <p className="small muted">
        デッキ編集の「みんなに投稿する」をオンにして保存したデッキが載ります。「インポート」で自分のデッキにコピーできます。
      </p>
      {msg && (
        <div className="panel row small ok">
          <span className="grow">✓ {msg}</span>
          <button className="small" onClick={() => nav('/decks')}>
            デッキ一覧へ
          </button>
          <button className="small" onClick={() => setMsg('')}>
            閉じる
          </button>
        </div>
      )}
      {loadError && (
        <div className="panel col small warn">
          <b>⚠ 投稿されたデッキを読み込めませんでした</b>
          <span>
            Firebase の Realtime Database のルールが古い可能性があります。管理者の方は、このサイトの <code>database.rules.json</code> の中身を Firebase コンソールの「ルール」タブに貼り直して「公開」してください。
          </span>
          <span className="muted">({loadError})</span>
        </div>
      )}
      <div className="panel col shared-filters">
        <div className="filter-row">
          <b className="filter-label">デッキ名・投稿者</b>
          <input className="grow" placeholder="デッキ名・投稿者の一部" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="filter-row">
          <b className="filter-label">入っているカード</b>
          <div className="col grow" style={{ gap: 4 }}>
            <input placeholder="カード名・読み (ひらがな可) で探して追加 (すべて入っているデッキ)" value={cardQ} onChange={(e) => setCardQ(e.target.value)} />
            {suggest.length > 0 && (
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                {suggest.map((n) => (
                  <button
                    key={n}
                    className="small"
                    onClick={() => {
                      setCards([...cards, n]);
                      setCardQ('');
                    }}
                  >
                    ＋ {n}
                  </button>
                ))}
              </div>
            )}
            {cards.length > 0 && (
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                {cards.map((n) => (
                  <button key={n} className="small primary" title="押すと外します" onClick={() => setCards(cards.filter((x) => x !== n))}>
                    {n} ✕
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="filter-row">
          <b className="filter-label">使用文明</b>
          {civToggles(useCivs, setUseCivs, noCivs)}
          <span className="small muted">選んだ文明をすべて使うデッキ</span>
        </div>
        <div className="filter-row">
          <b className="filter-label">使用しない文明</b>
          {civToggles(noCivs, setNoCivs, useCivs)}
          <span className="small muted">選んだ文明を1枚も使わないデッキ</span>
        </div>
        <div className="filter-row">
          <b className="filter-label">デッキタイプ</b>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {(['original', 'advance', 'duepa'] as Kind[]).map((k) => (
              <button key={k} className={`small chip${kinds.includes(k) ? ' primary' : ''}`} aria-pressed={kinds.includes(k)} onClick={() => toggle(kinds, setKinds, k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-row">
          <b className="filter-label">殿堂ゼロ</b>
          <select value={hof} onChange={(e) => setHof(e.target.value as Hof)}>
            <option value="all">すべて</option>
            <option value="zero">殿堂ゼロで使える</option>
            <option value="normalOnly">通常ルールのみ (殿堂ゼロでは使えない)</option>
          </select>
        </div>
        <div className="row">
          <span className="grow small muted">{shared == null ? (loadError ? '読み込めませんでした' : '読み込み中…') : `${hits.length} / ${infos.length} 件`}</span>
          <button className="small" disabled={!filtered} onClick={clear}>
            条件クリア
          </button>
        </div>
      </div>
      {shared != null && (
        <div className="panel col">
          <DeckSection title="投稿されたデッキ" empty={filtered ? '条件に合うデッキがありません' : 'まだ投稿がありません'}>
            {hits.map(({ s, kind, zeroOk }) => (
              <DeckTile
                key={s.key}
                db={db}
                deck={{ ...s.deck, updatedAt: s.updatedAt }}
                tag={
                  <>
                    {kind === 'duepa' && <span className="badge">デュエパ</span>}
                    {zeroOk && <span className="badge">殿堂ゼロ可</span>}
                    <span className="badge">{s.uid === user.uid ? '自分の投稿' : `投稿: ${s.owner}`}</span>
                  </>
                }
                actions={
                  <button className="small primary" onClick={() => importOne(s)}>
                    インポート
                  </button>
                }
              />
            ))}
          </DeckSection>
        </div>
      )}
    </div>
  );
}
