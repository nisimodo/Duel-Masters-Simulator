import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CardDetail, CardImg, CivDots, RegBadge } from '../components/CardView';
import { useApp } from '../context';
import { getDecks, saveDeck, SharedWriteError } from '../data/api';
import { CIV_COLOR, CIV_NAME, mainFace, type Card, type Civ, type DeckZone } from '../lib/cards';
import {
  copyLimit,
  countOf,
  DECK_SIZE,
  deckFormat,
  deckSizeBonus,
  deckThumb,
  DEFAULT_RULES,
  emptyDeck,
  mainSize,
  presetToDeck,
  randomDeck,
  validateDeck,
  type Deck,
  type DeckType,
} from '../lib/deck';
import { CARD_TYPES, emptyQuery, searchCards, type SearchQuery } from '../lib/search';
import { Modal } from '../game/dialogs';
import { FormatBadge } from '../components/DeckGrid';
import { NARROW, useMedia } from '../lib/useMedia';

const PAGE = 60;
const ZONE_LABEL: Record<DeckZone, string> = { main: 'メインデッキ', hyper: '超次元ゾーン', gr: '超GRゾーン' };

export default function DeckEditor() {
  const { db, user } = useApp();
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [q, setQ] = useState<SearchQuery>(emptyQuery);
  const [page, setPage] = useState(0);
  const [hover, setHover] = useState<Card | null>(null);
  const [msg, setMsg] = useState<{ text: string; warn?: string[] } | null>(null);
  const [dirty, setDirty] = useState(false);
  const narrow = useMedia(NARROW);
  const [tab, setTab] = useState<'search' | 'deck'>('search');
  const [detail, setDetail] = useState<Card | null>(null);
  const [moreFilters, setMoreFilters] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (id === 'new') {
      setDeck(emptyDeck((sp.get('type') as DeckType) || 'duema'));
      return;
    }
    getDecks(user.uid).then((ds) => {
      const d = ds.find((x) => x.id === id);
      if (d) setDeck(d);
      else nav('/decks');
    });
  }, [id, user, sp, nav]);

  const results = useMemo(() => (db ? searchCards(db, q) : []), [db, q]);
  useEffect(() => setPage(0), [q]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  if (!db || !user || !deck) return <div className="page muted">読み込み中…</div>;
  const rules = DEFAULT_RULES[deck.type];
  const issues = validateDeck(db, deck);

  // 連続タップでも取りこぼさないよう、常に最新のデッキに対して変更する
  const update = (fn: (d: Deck) => void) => {
    setDeck((prev) => {
      if (!prev) return prev;
      const d = structuredClone(prev);
      fn(d);
      return d;
    });
    setDirty(true);
  };

  const totalOf = (cid: string) => (deck.main[cid] ?? 0) + (deck.hyper[cid] ?? 0) + (deck.gr[cid] ?? 0) + (deck.partner === cid ? 1 : 0);

  const add = (card: Card) => {
    update((d) => {
      const z = card.zone;
      d[z][card.id] = (d[z][card.id] ?? 0) + 1;
    });
  };
  const remove = (card: Card, zone: DeckZone) => {
    update((d) => {
      const n = (d[zone][card.id] ?? 0) - 1;
      if (n <= 0) delete d[zone][card.id];
      else d[zone][card.id] = n;
    });
  };
  const setPartner = (card: Card) => {
    update((d) => {
      if (d.partner && d.partner !== card.id) d.main[d.partner] = (d.main[d.partner] ?? 0) + 1;
      d.partner = card.id;
      if (d.main[card.id]) {
        d.main[card.id]--;
        if (!d.main[card.id]) delete d.main[card.id];
      }
    });
  };

  const save = async () => {
    let newId: string;
    let shareFailed = false;
    try {
      newId = await saveDeck(user.uid, deck, user.name);
    } catch (e) {
      if (!(e instanceof SharedWriteError)) {
        setMsg({ text: `保存できませんでした: ${e instanceof Error ? e.message : e}` });
        return;
      }
      newId = e.deckId;
      shareFailed = true;
    }
    setDirty(false);
    setMsg({
      text: shareFailed
        ? '保存しました。ただし、みんなのデッキには投稿できませんでした (Firebase のルールが古い可能性があります。database.rules.json を貼り直してください)'
        : deck.shared
          ? '保存しました (みんなのデッキにも最新の内容を投稿しました)'
          : '保存しました',
      warn: issues.length ? issues : undefined,
    });
    if (id === 'new') nav(`/decks/${newId}`, { replace: true });
    else setDeck({ ...deck, id: newId });
  };

  const genRandom = () => {
    if (countOf(deck.main) && !confirm('今のデッキの内容をランダムなデッキで置き換えますか？')) return;
    const r = randomDeck(db, deck.type, rules);
    update((d) => {
      d.main = r.main;
      d.hyper = {};
      d.gr = {};
      d.partner = r.partner;
    });
  };

  const insertPreset = (pid: string) => {
    if (!pid) return;
    const { deck: p, notFound } = presetToDeck(db, pid);
    if (countOf(deck.main) && !confirm('今のデッキの内容をプリセットで置き換えますか？')) return;
    update((d) => {
      d.main = p.main;
      d.hyper = p.hyper;
      d.gr = p.gr;
      if (d.type === 'duepa') d.partner = p.partner;
      if (d.name.startsWith('新しい')) d.name = p.name;
    });
    if (notFound.length) setMsg({ text: `カードDBに見つからないカードがありました: ${notFound.join('、')}` });
  };

  const sortedEntries = (m: Record<string, number>) =>
    Object.entries(m)
      .map(([cid, n]) => ({ card: db.byId.get(cid), n, cid }))
      .sort((a, b) => (a.card ? mainFace(a.card).cost : 99) - (b.card ? mainFace(b.card).cost : 99) || a.cid.localeCompare(b.cid));

  const setQv = <K extends keyof SearchQuery>(k: K, v: SearchQuery[K]) => setQ({ ...q, [k]: v });
  const toggleCiv = (c: Civ | 'Z') => setQv('civs', q.civs.includes(c) ? q.civs.filter((x) => x !== c) : [...q.civs, c]);
  const pageCards = results.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.ceil(results.length / PAGE);

  return (
    <div className={`editor show-${tab}`}>
      <div className="editor-tabs">
        <button className={tab === 'search' ? 'primary' : ''} onClick={() => setTab('search')}>
          🔍 カード検索
        </button>
        <button className={tab === 'deck' ? 'primary' : ''} onClick={() => setTab('deck')}>
          📋 デッキ ({mainSize(deck)}){issues.length ? ' ⚠' : ''}
        </button>
      </div>
      <div className="col search-col">
        <div className={`panel col filters${narrow && !moreFilters ? ' collapsed' : ''}`} style={{ gap: 6 }}>
          <div className="row">
            <input className="grow" placeholder="カード名・読み (ひらがな可)" value={q.name} onChange={(e) => setQv('name', e.target.value)} />
            <input className="grow" placeholder="テキスト" value={q.text} onChange={(e) => setQv('text', e.target.value)} />
            <input className="grow" placeholder="種族" list="races" value={q.race} onChange={(e) => setQv('race', e.target.value)} />
            <datalist id="races">
              {db.races.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>
          {narrow && (
            <button className="small" onClick={() => setMoreFilters(!moreFilters)}>
              {moreFilters ? '▲ 絞り込みを閉じる' : '▼ 文明・コスト・種類で絞り込む'}
            </button>
          )}
          <div className="row filter-more">
            {(['L', 'W', 'D', 'F', 'N', 'Z'] as const).map((c) => (
              <label key={c} className="row" style={{ gap: 3 }}>
                <input type="checkbox" checked={q.civs.includes(c)} onChange={() => toggleCiv(c)} />
                <span className="civdot" style={{ background: CIV_COLOR[c] }} />
                {c === 'Z' ? '無色' : CIV_NAME[c]}
              </label>
            ))}
            <select value={q.civMode} onChange={(e) => setQv('civMode', e.target.value as SearchQuery['civMode'])}>
              <option value="any">いずれかを含む</option>
              <option value="all">すべて含む</option>
              <option value="exact">完全一致</option>
            </select>
          </div>
          <div className="row filter-more">
            コスト
            <input style={{ width: 60 }} value={q.costMin} onChange={(e) => setQv('costMin', e.target.value)} placeholder="下限" />～
            <input style={{ width: 60 }} value={q.costMax} onChange={(e) => setQv('costMax', e.target.value)} placeholder="上限" />
            パワー
            <input style={{ width: 70 }} value={q.powerMin} onChange={(e) => setQv('powerMin', e.target.value)} placeholder="下限" />～
            <input style={{ width: 70 }} value={q.powerMax} onChange={(e) => setQv('powerMax', e.target.value)} placeholder="上限" />
            <select value={q.type} onChange={(e) => setQv('type', e.target.value)}>
              <option value="">カードの種類: すべて</option>
              {CARD_TYPES.map((t) => (
                <option key={t.label}>{t.label}</option>
              ))}
            </select>
            <select value={q.reg} onChange={(e) => setQv('reg', e.target.value as SearchQuery['reg'])}>
              <option value="">殿堂: すべて</option>
              <option value="hof">殿堂入りのみ</option>
              <option value="premium">プレミアム殿堂のみ</option>
              <option value="free">殿堂以外</option>
            </select>
            <button className="small" onClick={() => setQ(emptyQuery)}>
              条件クリア
            </button>
          </div>
        </div>
        <div className="row">
          <span className="muted">{results.length.toLocaleString()} 件</span>
          <span className="grow" />
          <button className="small" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ◀
          </button>
          <span className="small">
            {pages ? page + 1 : 0}/{pages}
          </span>
          <button className="small" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            ▶
          </button>
        </div>
        <div className="small muted">
          タップ(クリック)で追加 / −で1枚減らす / iで詳細{deck.type === 'duepa' ? ' / デッキ画面の「P」でパートナーに設定' : ''}
        </div>
        <div className="result-grid">
          {pageCards.map((c) => {
            const n = totalOf(c.id);
            const lim = copyLimit(db, c, rules);
            const wrongZone = deck.type === 'duepa' && c.zone !== 'main';
            return (
              <CardImg
                key={c.id}
                card={c}
                onHover={setHover}
                onClick={(e: MouseEvent) => {
                  if (e.shiftKey && deck.type === 'duepa') setPartner(c);
                  else add(c);
                }}
                onContextMenu={(e: MouseEvent) => {
                  e.preventDefault();
                  if (deck.partner === c.id) update((d) => (d.partner = null));
                  else if (deck[c.zone][c.id]) remove(c, c.zone);
                }}
                title={c.name}
              >
                {n > 0 && <span className="count" style={{ color: n > lim ? 'var(--danger)' : undefined }}>{n}</span>}
                <button
                  className="mini info"
                  title="詳細"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDetail(c);
                  }}
                >
                  i
                </button>
                {n > 0 && (
                  <button
                    className="mini minus"
                    title="1枚減らす"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (deck.partner === c.id && !deck[c.zone][c.id]) update((d) => (d.partner = null));
                      else remove(c, c.zone);
                    }}
                  >
                    −
                  </button>
                )}
                {(lim === 0 || wrongZone) && <span className="tag error">使用不可</span>}
                {db.regStatus.get(c.id) === 'hof' && lim > 0 && <span className="tag">殿堂</span>}
              </CardImg>
            );
          })}
        </div>
      </div>

      <div className="col deck-col">
        <div className="panel col" style={{ gap: 6 }}>
          <input value={deck.name} onChange={(e) => update((d) => (d.name = e.target.value))} style={{ fontWeight: 'bold' }} />
          <div className="row">
            <span className="badge">{deck.type === 'duema' ? 'デュエマ' : 'デュエパ'}</span>
            {deckFormat(db, deck) && (
              <span title="超次元・超GRゾーンやゲーム開始時に置かれるカードを使うとアドバンス、使わなければオリジナル (アドバンスでも使えます)">
                <FormatBadge format={deckFormat(db, deck)!} />
              </span>
            )}
            <b>
              {mainSize(deck)} / {DECK_SIZE[deck.type] + deckSizeBonus(db, deck)}
            </b>
            {deck.type === 'duema' && (
              <span className="small muted">
                超次元 {countOf(deck.hyper)}/8 ・ GR {countOf(deck.gr)}/12
              </span>
            )}
          </div>
          <div className="row small">
            <label className="switch" title="オンにして保存すると「みんなのデッキ」に載り、ほかの人がインポートできます">
              <input type="checkbox" role="switch" checked={!!deck.shared} onChange={(e) => update((d) => (d.shared = e.target.checked))} />
              みんなに投稿する
            </label>
            <span className="muted">{deck.shared ? '保存すると最新の内容が投稿されます' : 'オフにして保存すると投稿を取り下げます'}</span>
          </div>
          <div className="row">
            <button className="primary" onClick={save}>
              保存{dirty ? ' *' : ''}
            </button>
            <button onClick={genRandom}>ランダム生成</button>
            {db.presets.some((p) => (p.mode ?? 'duema') === deck.type) && (
              <select value="" onChange={(e) => insertPreset(e.target.value)}>
                <option value="">プリセット挿入…</option>
                {db.presets.filter((p) => (p.mode ?? 'duema') === deck.type).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <button className="small" onClick={() => confirm('デッキを空にしますか？') && update((d) => ((d.main = {}), (d.hyper = {}), (d.gr = {}), (d.partner = null)))}>
              クリア
            </button>
            <button className="small" onClick={() => nav('/decks')}>
              一覧へ
            </button>
          </div>
          {msg && (
            <div className="small">
              <span className="ok">{msg.text}</span>
              {msg.warn && <div className="warn">⚠ レギュレーション違反があります (保存はされています)</div>}
            </div>
          )}
          {issues.length > 0 && (
            <ul className="small warn" style={{ margin: 0, paddingLeft: 18 }}>
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </div>

        {deck.type === 'duema' && (
          <div className="panel col" style={{ gap: 4 }}>
            <b>サムネイル</b>
            {(() => {
              const tid = deckThumb(deck);
              const tc = tid ? db.byId.get(tid) : undefined;
              return tc ? (
                <div className="row">
                  <CardImg card={tc} width={60} onHover={setHover} />
                  <span className="grow">
                    {tc.name}
                    {!deck.thumb || deck.thumb !== tid ? <span className="small muted"> (自動)</span> : null}
                  </span>
                  {deck.thumb && (
                    <button className="small" onClick={() => update((d) => (d.thumb = null))}>
                      自動に戻す
                    </button>
                  )}
                </div>
              ) : (
                <span className="small muted">カードを入れると表示されます</span>
              );
            })()}
            <span className="small muted">デッキ内の「★」ボタンで、サムネイルにするカードを選べます</span>
          </div>
        )}

        {deck.type === 'duepa' && (
          <div className="panel col" style={{ gap: 4 }}>
            <b>パートナー (サムネイルになります)</b>
            {deck.partner && db.byId.get(deck.partner) ? (
              <div className="row">
                <CardImg card={db.byId.get(deck.partner)!} width={60} onHover={setHover} />
                <span>{db.byId.get(deck.partner)!.name}</span>
                <button className="small" onClick={() => update((d) => (d.partner = null))}>
                  解除
                </button>
              </div>
            ) : (
              <span className="small muted">コスト5以上のクリーチャーを Shift+クリック (またはデッキ内の「P」ボタン) で設定</span>
            )}
          </div>
        )}

        {(['main', 'hyper', 'gr'] as const).map((z) =>
          z !== 'main' && deck.type === 'duepa' ? null : (
            <div key={z} className="panel col" style={{ gap: 2 }}>
              <b>
                {ZONE_LABEL[z]} ({countOf(deck[z])})
              </b>
              {sortedEntries(deck[z]).map(({ card, n, cid }) =>
                card ? (
                  <div key={cid} className="deck-list-row" onMouseEnter={() => setHover(card)}>
                    <span className="small" style={{ width: 18, textAlign: 'right' }}>
                      {mainFace(card).cost}
                    </span>
                    <CivDots card={card} />
                    <span className="grow small" onClick={() => setDetail(card)} style={{ cursor: 'pointer' }}>
                      {card.name}
                    </span>
                    <RegBadge db={db} card={card} />
                    {deck.type === 'duepa' && mainFace(card).isCreature && (
                      <button className="small" title="パートナーに設定" onClick={() => setPartner(card)}>
                        P
                      </button>
                    )}
                    {deck.type === 'duema' && (
                      <button
                        className={`small${deckThumb(deck) === cid && deck.thumb === cid ? ' primary' : ''}`}
                        title="デッキのサムネイルにする"
                        onClick={() => update((d) => (d.thumb = cid))}
                      >
                        ★
                      </button>
                    )}
                    <button className="small" onClick={() => remove(card, z)}>
                      −
                    </button>
                    <b style={{ width: 20, textAlign: 'center' }}>{n}</b>
                    <button className="small" onClick={() => add(card)}>
                      ＋
                    </button>
                  </div>
                ) : (
                  <div key={cid} className="small error">
                    不明なカード {cid}
                  </div>
                ),
              )}
            </div>
          ),
        )}

        {!narrow && (
          <div className="panel">
            <CardDetail db={db} card={hover} />
          </div>
        )}
      </div>
      {detail && (
        <Modal title="カードの詳細" onClose={() => setDetail(null)}>
          <CardDetail db={db} card={detail} />
          <div className="row">
            <button className="primary" onClick={() => add(detail)}>
              ＋ デッキに追加 ({totalOf(detail.id)}枚)
            </button>
            {deck.type === 'duepa' && mainFace(detail).isCreature && <button onClick={() => setPartner(detail)}>パートナーに設定</button>}
            {deck.type === 'duema' && totalOf(detail.id) > 0 && <button onClick={() => update((d) => (d.thumb = detail.id))}>サムネイルにする</button>}
          </div>
        </Modal>
      )}
    </div>
  );
}
