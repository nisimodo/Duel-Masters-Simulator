// 名前のある能力 (B・A・D・マナ爆誕・エターナル・Ω・ガードマン 等) のテスト
import { describe, expect, it } from 'vitest';
import { buildDB } from '../lib/cards';
import { applyAction, attackTargets, breakCount, breakShields, canAttackWith, createGame, kwOf, moveCard, power } from './engine';
import { programOf, startExec } from './interp';
import { costOf } from './statics';
import { spellEffectLines } from '../lib/triggers';
import type { Action, GameState } from './types';

const cr = (id: string, cost: number, power: number, text: string[], civ = 'F') => ({
  id,
  n: id,
  img: '',
  f: [{ n: id, t: 'クリーチャー', c: civ, co: cost, p: String(power), r: ['テスト'], x: text }],
});

const db = buildDB(
  [
    cr('vanilla', 1, 1000, []),
    cr('ulim', 1, 1000, ['相手のターンのはじめに、相手は自身のマナゾーンのカードを２枚までしかアンタップできない。']),
    { id: 'scrch', n: 'scrch', img: '', f: [{ n: 'scrch', t: '呪文', c: 'F', co: 1, p: null, r: [], x: ['このターン、次に自分が召喚するクリーチャーのコストを１少なくする。ただし、コストは０以下にはならない。そのクリーチャーが出た時、このターン、そのクリーチャーに「スピードアタッカー」を与える。', 'この呪文を唱えた後、墓地に置くかわりに山札に加えてシャッフルする。'] }] },
    { id: 'slock', n: 'slock', img: '', f: [{ n: 'slock', t: '呪文', c: 'F', co: 1, p: null, r: [], x: ['相手は、次の自身のターンにクリーチャーを召喚できず、呪文を唱えることもできない。'] }] },
    cr('lightHunter', 1, 1000, ['このクリーチャーは、タップされていない光のクリーチャーを攻撃できる。']),
    cr('lightMon', 1, 1000, [], 'L'),
    cr('loneWB', 1, 1000, ['バトルゾーンに自分のクリーチャーが他になければ、このクリーチャーは「パワーアタッカー+3000」と「W・ブレイカー」を得る。']),
    cr('condST', 1, 1000, ['相手のクリーチャーが2体以上あれば、自分のシールドゾーンにあるこのクリーチャーに「S・トリガー」を与える。']),
    cr('tapGuard', 1, 1000, ['このクリーチャーがタップしていれば、自分は攻撃されない。']),
    cr('dante', 1, 1000, ['このクリーチャーが破壊される時、かわりに自分の山札の上に置く。']),
    cr('bad', 4, 5000, ['B・A・D2(このクリーチャーを、コストを2少なくして召喚してもよい。そうしたら、このターンの終わりにこのクリーチャーを破壊する)']),
    cr('baku', 5, 5000, ['マナ爆誕3(このクリーチャーを自分のマナゾーンから、コスト3を支払って召喚してもよい)']),
    cr('omega', 1, 5000, ['エターナル・Ω(このクリーチャーがバトルゾーンを離れる時、かわりに手札に戻す)']),
    cr('guard', 1, 6000, ['ガードマン(自分の他のクリーチャーが攻撃される時、このクリーチャーをタップしてもよい。そうした場合、攻撃クリーチャーはかわりにこのクリーチャーを攻撃する)']),
    cr('sa', 1, 3000, ['スピードアタッカー']),
    {
      id: 'hyper',
      n: 'hyper',
      img: '',
      f: [
        { n: 'hyper', t: 'クリーチャー', c: 'F', co: 3, p: '3000', r: ['テスト'], x: ['ハイパー化:自分の他のクリーチャーを1体タップする。'] },
        { n: 'hyper', t: 'クリーチャー', c: 'F', co: 3, p: '9000', r: ['テスト'], x: ['ハイパー化:自分の他のクリーチャーを1体タップする。', 'W・ブレイカー'] },
      ],
    },
    cr('tapper', 1, 1000, ['このクリーチャーで攻撃するかわりに、タップして次の能力を使ってもよい。', 'カードを2枚引く。']),
    { id: 'sv1', n: 'sv1', img: '', f: [{ n: 'sv1', t: 'クリーチャー', c: 'F', co: 1, p: '1000', r: ['サバイバー'], x: ['oS このクリーチャーのパワーは+2000される。', 'サバイバー(自分のサバイバーはすべて、上のoS 能力を持つ)'] }] },
    { id: 'sv2', n: 'sv2', img: '', f: [{ n: 'sv2', t: 'クリーチャー', c: 'F', co: 1, p: '1000', r: ['サバイバー'], x: [] }] },
    cr('wave', 1, 1000, ['ウェーブストライカー(バトルゾーンに「ウェーブストライカー」を持つクリーチャーが他に2体以上あれば、このクリーチャーは次の能力を得る)', 'W・ブレイカー']),
    cr('mugen', 7, 7000, ['ムゲンクライム2(自分のクリーチャーを2体タップし、[ff02]支払って、このクリーチャーを自分の手札または墓地から召喚してもよい)']),
    { id: 'gear', n: 'gear', img: '', f: [{ n: 'gear', t: 'クロスギア', c: 'F', co: 2, p: null, r: [], x: ['クロスギア', 'これをクロスしたクリーチャーのパワーは+3000される。'] }] },
    {
      id: 'psy',
      n: 'psy',
      img: '',
      f: [
        { n: 'psy', t: 'サイキック・クリーチャー', c: 'F', co: 5, p: '5000', r: ['テスト'], x: ['覚醒-自分のターンのはじめに、このクリーチャーをコストの大きいほうに裏返す。'] },
        { n: 'psy覚醒', t: 'サイキック・クリーチャー', c: 'F', co: 10, p: '15000', r: ['テスト'], x: ['解除(このクリーチャーがバトルゾーンを離れる時、バトルゾーンを離れるかわりに、コストの小さいほうに裏返す)'] },
      ],
    },
    { id: 'godA', n: 'godA', img: '', f: [{ n: '神A', t: 'クリーチャー', c: 'F', co: 3, p: '3000', r: ['ゴッド'], x: ['G・リンク《神B》の左横'] }] },
    { id: 'godB', n: 'godB', img: '', f: [{ n: '神B', t: 'クリーチャー', c: 'F', co: 3, p: '4000', r: ['ゴッド'], x: ['G・リンク《神A》の右横', 'W・ブレイカー'] }] },
    {
      id: 'dh',
      n: 'dh',
      img: '',
      f: [
        { n: 'dh', t: 'ドラグハート・ウエポン', c: 'F', co: 2, p: null, r: [], x: ['龍解:自分のターンの終わりに、これを装備したクリーチャーがタップされていれば、このドラグハートをクリーチャー側に裏返し、アンタップする。'] },
        { n: 'dh龍', t: 'ドラグハート・クリーチャー', c: 'F', co: 7, p: '9000', r: ['テスト'], x: [] },
      ],
    },
    cr('galaxy', 8, 8000, ['ギャラクシールド [ll03](このカードを使うコストの代わりに、 [ll03]を支払ってもよい。そうしたら、このカードを表向きにし、新しいシールドとしてシールドゾーンに置く)', '自分のターンのはじめに、このクリーチャーが表向きで自分のシールドゾーンにあれば、コストを支払ったものとして召喚する。']),
    cr('fushigi', 9, 9000, ['フシギバース [nn09](自分のクリーチャーを1体タップしてマナゾーンに置き、[nn09]からそのクリーチャーのコストを引いた数のコストを支払って、このクリーチャーを自分の墓地から召喚してもよい)']),
    cr('big', 6, 6000, []),
    { id: 'ex1', n: 'ex1', img: '', f: [{ n: '暴剣王A', t: 'エグザイル・クリーチャー', c: 'F', co: 1, p: '1000', r: [], x: ['自分の他の、名前に《暴剣》とあるエグザイル・クリーチャーをバトルゾーンに出すことはできない。'] }] },
    { id: 'ex2', n: 'ex2', img: '', f: [{ n: '暴剣王B', t: 'エグザイル・クリーチャー', c: 'F', co: 1, p: '1000', r: [], x: ['自分の他の、名前に《暴剣》とあるエグザイル・クリーチャーをバトルゾーンに出すことはできない。'] }] },
    { id: 'chance', n: 'chance', img: '', f: [{ n: 'chance', t: '呪文', c: 'F', co: 9, p: null, r: [], x: ['アタック・チャンス-テスト(自分のテストが攻撃する時、この呪文をコストを支払わずに唱えてもよい)', 'カードを2枚引く。'] }] },
    cr('space', 1, 1000, ['スペース・チャージ:火(自分のマナゾーンに火のカードが置かれた時、このクリーチャーの q 能力を使ってもよい)', 'q カードを1枚引く。']),
    cr('ddd', 6, 6000, ['D・D・D [ff02](自分のクリーチャーが攻撃する時、このカードを [ff02]支払って自分の手札から実行してもよい)']),
    cr('must', 1, 2000, ['スピードアタッカー', 'このクリーチャーは、可能であれば毎ターン攻撃する。']),
    cr('lure', 1, 1000, ['相手のクリーチャーは、可能ならこのクリーチャーを攻撃する。']),
    { id: 'jc', n: 'jc', img: '', f: [{ n: 'jc', t: 'クリーチャー', c: 'F', co: 2, p: '2000', r: ['ジョーカーズ'], x: ['このクリーチャーが攻撃する時、このクリーチャーと自分のマナゾーンにあるコスト5以下のジョーカーズ1体を入れ替えてもよい。', 'スピードアタッカー'] }] },
    { id: 'jm', n: 'jm', img: '', f: [{ n: 'jm', t: 'クリーチャー', c: 'F', co: 5, p: '5000', r: ['ジョーカーズ'], x: [] }] },
    {
      id: 'cellA',
      n: 'cellA',
      img: '',
      f: [
        { n: 'セルA', t: 'サイキック・クリーチャー', c: 'F', co: 4, p: '4000', r: [], x: ['覚醒 (サイキック)リンク - 自分のターンのはじめに、バトルゾーンに自分の《セルB》があれば、そのクリーチャーとこのクリーチャーを裏返しリンクさせる。'] },
        { n: 'スーパー', t: 'サイキック・スーパー・クリーチャー', c: 'F', co: 15, p: '20000', r: [], x: ['T・ブレイカー', 'リンク解除(このクリーチャーがバトルゾーンを離れる時、そのサイキック・セルのいずれか1枚を選んで超次元ゾーンに戻し、残りのカードを裏返す)'] },
      ],
    },
    {
      id: 'cellB',
      n: 'cellB',
      img: '',
      f: [
        { n: 'セルB', t: 'サイキック・クリーチャー', c: 'F', co: 7, p: '7000', r: [], x: [] },
        { n: 'スーパー', t: 'サイキック・スーパー・クリーチャー', c: 'F', co: 15, p: '20000', r: [], x: ['T・ブレイカー'] },
      ],
    },
    cr('silent', 2, 2000, ['サイレントスキル(自分のターンのはじめに、このクリーチャーがタップされていたら、アンタップするかわりに次の能力を使ってもよい)', 'カードを2枚引く。']),
    { id: 'aura', n: 'aura', img: '', f: [{ n: 'aura', t: 'オレガ・オーラ', c: 'F', co: 2, p: '+6000', r: [], x: ['これを付けたクリーチャーのパワーを+6000する。', 'これを付けたクリーチャーに「パワード・ブレイカー」を与える。'] }] },
    { id: 'grc', n: 'grc', img: '', f: [{ n: 'grc', t: 'GRクリーチャー', c: 'F', co: 2, p: '2000', r: [], x: [] }] },
    cr('marshal', 3, 3000, ['マーシャル・タッチ(このクリーチャーをバトルゾーンに出した時、自分の他のクリーチャーを1体、バトルゾーンから手札に戻してもよい。そうした場合、このクリーチャーの能力を使う)', 'カードを2枚引く。']),
    cr('meta', 3, 3000, ['メタモーフ(自分のマナゾーンに7枚以上カードがあれば、このクリーチャーは次の能力を得る)', 'W・ブレイカー']),
    { id: 'cyc', n: 'cyc', img: '', f: [{ n: 'cyc', t: '呪文', c: 'F', co: 1, p: null, r: [], x: ['サイクロン(このターン、この呪文を唱える直前にクリーチャーを召喚していれば、この呪文を唱えた後、墓地に置くかわりに自分の手札に戻す)', 'カードを1枚引く。'] }] },
    { id: 'baku2', n: 'baku2', img: '', f: [{ n: 'baku2', t: '呪文', c: 'F', co: 1, p: null, r: [], x: ['次のうちいずれかひとつを選ぶ。', '▶カードを1枚引く。', '▶カードを2枚引く。', '爆進ダブル(バトルゾーンに自分の進化クリーチャーがあれば、この効果を両方とも選んでもよい)'] }] },
    cr('ek', 3, 3000, ['エターナル・Κ(このクリーチャーが離れる時、かわりに自分のマナゾーンにある裏向きのカードを3枚、表向きにしてもよい)']),
    cr('crystal', 6, 6000, ['水晶ソウル3(このクリーチャーを召喚する時、自分のマナゾーンにある裏向きのカードのマナの数字は3になる)']),
    cr('downer', 1, 1000, ['このクリーチャーが出た時、自分のマナゾーンのカードを1枚、裏向きにしてもよい。']),
    cr('repl', 3, 3000, ['このクリーチャーが破壊される時、墓地に置くかわりに自分の他のクリーチャーを1体破壊してもよい。']),
    cr('sgo', 3, 3000, ['シールド・ゴー(このクリーチャーが破壊された時、新しいシールドとして自分のシールドゾーンに表向きのまま加える。このクリーチャーが表向きで、シールドゾーンを離れる時、かわりに自分の墓地に置く)']),
    { id: 'manaevo', n: 'manaevo', img: '', f: [{ n: 'manaevo', t: '進化クリーチャー', c: 'F', co: 2, p: '9000', r: ['テスト'], x: ['マナ進化:テストを1体自分のマナゾーンから選び、このクリーチャーをその上に重ねつつバトルゾーンに出す。'] }] },
    { id: 'shift', n: 'shift', img: '', f: [{ n: 'shift', t: '進化クリーチャー', c: 'F', co: 7, p: '9000', r: ['テスト'], x: ['ソウルシフト(このクリーチャーを召喚する時、このクリーチャーの進化元クリーチャーを選ぶ。このクリーチャーのコストは、その選んだクリーチャーのコストだけ少なくなる)', '進化-自分のテスト1体の上に置く。'] }] },
    { id: 'pickrace', n: 'pickrace', img: '', f: [{ n: 'pickrace', t: '呪文', c: 'F', co: 1, p: null, r: [], x: ['種族をひとつ選ぶ。自分の墓地から、その種族のクリーチャーを1体選び、自分の手札に加える。'] }] },
    { id: 'drg', n: 'drg', img: '', f: [{ n: 'drg', t: 'クリーチャー', c: 'F', co: 5, p: '5000', r: ['アーマード・ドラゴン'], x: [] }] },
    cr('sealer', 2, 2000, ['このクリーチャーが出た時、相手のクリーチャーを1体選び、相手はそれに封印をひとつ付ける。']),
    { id: 'cmd', n: 'cmd', img: '', f: [{ n: 'cmd', t: 'クリーチャー', c: 'F', co: 1, p: '1000', r: ['ドラゴン・コマンド'], x: [] }] },
    cr('buzz', 2, 2000, ['バズレンダ [ff01](このクリーチャーのコストを支払う時、追加で [ff01]を好きな回数支払ってもよい。このクリーチャーがバトルゾーンに出た時、その{OL} 能力を1回と、追加で [ff01]支払った回数、使う)', '{OL}カードを1枚引く。']),
    cr('vivid', 7, 7000, ['ビビッドロー [ff02](自分のターン中、攻撃の前にこのクリーチャーをドローした時、表向きにしてもよい。そうしたら、このターンこのクリーチャーを [ff02] 支払って召喚してもよい)']),
    { id: 'gyaku', n: 'gyaku', img: '', f: [{ n: 'gyaku', t: '呪文', c: 'F', co: 9, p: null, r: [], x: ['逆転撃{ff05}:クリーチャーが自分を攻撃する時、その攻撃中にまだ「逆転撃」を使っていなければ、この呪文を自分の手札からコストを支払わずに唱えてもよい。そうしたら、次の自分のターンのはじめに{ff05}を支払う。支払えなければ、自分はゲームに負ける。', 'カードを1枚引く。'] }] },
    cr('odr', 2, 2000, ['O・ドライブ 火x2 (このクリーチャーを召喚する時、自分のマナゾーンで火のカードをさらに2枚タップしてもよい。そうした場合、次の能力を得る)', 'このクリーチャーが出た時、カードを2枚引く。', 'W・ブレイカー']),
    { id: 'devo', n: 'devo', img: '', f: [{ n: 'devo', t: '進化クリーチャー', c: 'F', co: 2, p: '9000', r: ['テスト'], x: ['デッキ進化-自分の山札の上から1枚目を表向きにする。そのカードがクリーチャーであれば、このクリーチャーをその上に重ねつつバトルゾーンに出す。そのカードがクリーチャー以外であれば、このクリーチャーを自分の手札に戻す。'] }] },
    cr('dyn', 1, 3000, ['ダイナモ(バトルが始まる時、あるいはこのクリーチャーで攻撃できる時、このクリーチャーをタップしてもよい。そうした場合、そのターンの終わりまで、このクリーチャーのパワーと能力をバトルゾーンにある自分の他のダイナモ1体に加える)']),
    { id: 'castle', n: 'castle', img: '', f: [{ n: 'castle', t: '城', c: 'F', co: 2, p: null, r: [], x: ['城-自分のシールドをひとつ選び、このカードを付けて要塞化する。その要塞化されたシールドがシールドゾーンから離れた時、このカードを自分の墓地に置く。', 'バトルゾーンにある自分のクリーチャーすべてのパワーは+3000される。'] }] },
    {
      id: 'kodo',
      n: 'kodo',
      img: '',
      f: [
        { n: '禁断の鼓動', t: '禁断の鼓動', c: 'F', co: 0, p: null, r: [], x: ['この鼓動は、ゲーム開始時、封印を2つ付けてバトルゾーンに置く。', 'この鼓動はバトルゾーンを離れない。', '禁断解放-この鼓動の封印がすべてなくなった時、クリーチャー側に裏返す。'] },
        { n: '禁断クリーチャー', t: '禁断クリーチャー', c: 'F', co: 99, p: '99999', r: [], x: ['このカードがバトルゾーン以外のゾーンにあれば、自分はゲームに負ける。'] },
      ],
    },
    cr('stayT', 3, 3000, ['このクリーチャーがバトルゾーンを離れる時、タップされていれば、離れるかわりにとどまる。']),
    cr('b2g', 3, 3000, ['スピードアタッカー', 'このクリーチャーがシールドをブレイクする時、相手はそのシールドを自身の手札に加えるかわりに墓地に置く。']),
    { id: 'gachaSp', n: 'gachaSp', img: '', f: [{ n: 'gachaSp', t: '呪文', c: 'F', co: 1, p: null, r: [], x: ['ドギラゴン・ガチャを2度回す。回すたびに、その能力を使う。'] }] },
    cr('ddisc', 6, 6000, ['このクリーチャーを召喚する時、自分の手札を1枚捨ててもよい。そうしたら、このクリーチャーの召喚コストを3少なくする。']),
    cr('oni', 2, 2000, ['このクリーチャーは攻撃できない。', '鬼タイム :自分と相手のシールドの数が合計6つ以下なら、真上の▪️能力を無視する。', 'スピードアタッカー']),
    cr('space2', 1, 1000, ['スペース・チャージ（自分のマナゾーンにカードが置かれた時、そのカードの文明に合うq能力を使ってもよい）', 'q 光：カードを1枚引く。', 'q 火：カードを2枚引く。']),
    { id: 'jokA', n: 'jokA', img: '', f: [{ n: 'jokA', t: 'クリーチャー', c: 'F', co: 1, p: '1000', r: ['ジョーカーズ'], x: ['このクリーチャーが出た時、カードを2枚引く。'] }] },
    { id: 'jbig', n: 'jbig', img: '', f: [{ n: 'jbig', t: 'クリーチャー', c: 'F', co: 1, p: '1000', r: ['ジョーカーズ'], x: ['このクリーチャーが出た時、Jビッグ1する。(自分の他のジョーカーズの、Jビッグ1以外の、出た時にトリガーする能力を1つ使う)'] }] },
    { id: 'md', n: 'md', img: '', f: [{ n: 'md', t: 'クリーチャー', c: 'F', co: 1, p: '1000', r: ['魔導具'], x: [] }] },
    { id: 'mug', n: 'mug', img: '', f: [{ n: 'mug', t: 'クリーチャー', c: 'D', co: 9, p: '12000', r: ['テスト'], x: ['無月の門：自分の魔導具をバトルゾーンに出した時、自分の魔導具をバトルゾーンと墓地から２つずつ選び、このクリーチャーを自分の手札または墓地からそれら４枚の上にコストを支払わずに召喚してもよい。'] }] },
    { id: 'eachSp', n: 'eachSp', img: '', f: [{ n: 'eachSp', t: '呪文', c: 'F', co: 1, p: null, r: [], x: ['各プレイヤーは自身のマナゾーンからカードを1枚ずつ選び、それぞれの手札に戻す。'] }] },
    { id: 'tmpSp', n: 'tmpSp', img: '', f: [{ n: 'tmpSp', t: '呪文', c: 'F', co: 1, p: null, r: [], x: ['このターン、自分のクリーチャーが攻撃する時、カードを1枚引く。'] }] },
    cr('sinka', 1, 1000, ['シンカパワー：このクリーチャーが進化する時、カードを1枚引く。']),
    { id: 'evo1', n: 'evo1', img: '', f: [{ n: 'evo1', t: '進化クリーチャー', c: 'F', co: 1, p: '5000', r: ['テスト'], x: ['進化-自分のテスト1体の上に置く。'] }] },
    cr('fort', 1, 1000, ['フォートE：テスト(このクリーチャーをバトルゾーンに出した時、テストを自分のマナゾーンでタップしてこのクリーチャーを召喚していた場合、このクリーチャーは次の能力を得る)', 'このクリーチャーのパワーは+5000される。']),
    {
      id: 'rin',
      n: 'rin',
      img: '',
      f: [
        { n: 'rin', t: 'クリーチャー', c: 'F', co: 2, p: '2000', r: ['テスト'], x: ['輪廻∞：このカードの呪文側を、バトルゾーンに置いたまま唱えてもよい（コストは支払う）。そうした時、カードを1枚引く。'] },
        { n: 'rin呪文', t: '呪文', c: 'F', co: 1, p: null, r: [], x: ['カードを1枚引く。'] },
      ],
    },
    cr('hakuyon', 2, 2000, ['自分の「無月の門」能力を使った時、このクリーチャーを自分の墓地からバトルゾーンにタップして出してもよい。']),
    cr('ebase', 1, 1000, ['このカードが墓地に置かれた時、それが墓地に置かれる直前に進化クリーチャーの下にあった場合、カードを１枚引いてもよい。']),
    { id: 'dl', n: 'dl', img: '', f: [{ n: 'dl', t: 'デュエリスト', c: 'F', co: 0, p: null, r: [], x: ['デュエリスト：', 'テスタ (各ターンに１度、自分のマナゾーンにあるカードの枚数以下のコストで種族にテスタを持つデュエルメイト・カードを１枚、自分の超次元ゾーンからコストを支払わずに実行してもよい)'] }] },
    { id: 'dl2', n: 'dl2', img: '', f: [{ n: 'dl2', t: 'デュエリスト', c: 'F', co: 0, p: null, r: [], x: ['デュエリスト：', 'テスタ (各ターンに１度…)', 'デュエリスト・リンク：', 'テスタ (自分の、種族にテスタを持つ、異なる名前のデュエルメイト・カードが３枚バトルゾーンにあれば、それら１つずつを裏返しリンクさせる）'] }] },
    { id: 'lm1', n: 'lm1', img: '', f: [{ n: 'lm1', t: 'デュエルメイト・クリーチャー', c: 'F', co: 2, p: '2000', r: ['テスタ'], x: [] }, { n: 'super', t: 'デュエルメイト・スーパー・クリーチャー', c: 'F', co: 10, p: '11000', r: ['テスタ'], x: ['（リンクしたクリーチャーは、リンクしたターンに攻撃できる）', 'W・ブレイカー', 'このクリーチャーが離れる時、かわりに自分の《dl2》１つを破壊する。'] }] },
    { id: 'lm2', n: 'lm2', img: '', f: [{ n: 'lm2', t: 'デュエルメイト・クリーチャー', c: 'F', co: 2, p: '2000', r: ['テスタ'], x: [] }, { n: 'super', t: 'デュエルメイト・スーパー・クリーチャー', c: 'F', co: 10, p: '11000', r: ['テスタ'], x: ['（リンクしたクリーチャーは、リンクしたターンに攻撃できる）', 'W・ブレイカー', 'このクリーチャーが離れる時、かわりに自分の《dl2》１つを破壊する。'] }] },
    { id: 'lm3', n: 'lm3', img: '', f: [{ n: 'lm3', t: 'デュエルメイト・クリーチャー', c: 'F', co: 2, p: '2000', r: ['テスタ'], x: [] }, { n: 'super', t: 'デュエルメイト・スーパー・クリーチャー', c: 'F', co: 10, p: '11000', r: ['テスタ'], x: ['（リンクしたクリーチャーは、リンクしたターンに攻撃できる）', 'W・ブレイカー', 'このクリーチャーが離れる時、かわりに自分の《dl2》１つを破壊する。'] }] },
    { id: 'dsp', n: 'dsp', img: '', f: [{ n: 'dsp', t: 'デュエルメイト呪文', c: 'F', co: 1, p: null, r: ['テスタ'], x: ['カードを１枚引く。', 'この呪文を唱えた後、墓地のかわりに自分の《dl2》１つの下に置く。'] }] },
    { id: 'dm', n: 'dm', img: '', f: [{ n: 'dm', t: 'デュエルメイト・クリーチャー', c: 'F', co: 3, p: '3000', r: ['テスタ'], x: [] }] },
    {
      id: 'zero',
      n: 'zero',
      img: '',
      f: [
        { n: 'zero', t: '零龍の儀', c: 'D', co: 0, p: null, r: [], x: ['ゲーム開始時、このカードと、異なる４種類の零龍星雲を、リンクせずにバトルゾーンに置く。', '零龍カードはバトルゾーンを離れない。'] },
        { n: '零龍', t: '零龍クリーチャー', c: 'D', co: 0, p: '0', r: [], x: ['ワールド・ブレイカー', 'このクリーチャーが零龍卍誕した時、そのターン、相手のクリーチャーすべてのパワーを０にする。', 'このクリーチャーは、パワーが０以下の間バトルゾーンを離れず、すべてのバトルに勝つ。'] },
      ],
    },
    { id: 'st1', n: 'st1', img: '', f: [{ n: 'st1', t: '零龍星雲', c: 'D', co: 0, p: null, r: [], x: ['自分のターンの終わりに、この零龍星雲を自分の《zero》にリンクしてもよい。'] }, { n: '零龍', t: '零龍クリーチャー', c: 'D', co: 0, p: '0', r: [], x: [] }] },
    { id: 'st2', n: 'st2', img: '', f: [{ n: 'st2', t: '零龍星雲', c: 'D', co: 0, p: null, r: [], x: ['自分のターンの終わりに、この零龍星雲を自分の《zero》にリンクしてもよい。'] }, { n: '零龍', t: '零龍クリーチャー', c: 'D', co: 0, p: '0', r: [], x: [] }] },
    { id: 'st3', n: 'st3', img: '', f: [{ n: 'st3', t: '零龍星雲', c: 'D', co: 0, p: null, r: [], x: ['自分のターンの終わりに、この零龍星雲を自分の《zero》にリンクしてもよい。'] }, { n: '零龍', t: '零龍クリーチャー', c: 'D', co: 0, p: '0', r: [], x: [] }] },
    { id: 'st4', n: 'st4', img: '', f: [{ n: 'st4', t: '零龍星雲', c: 'D', co: 0, p: null, r: [], x: ['自分のターンの終わりに、この零龍星雲を自分の《zero》にリンクしてもよい。'] }, { n: '零龍', t: '零龍クリーチャー', c: 'D', co: 0, p: '0', r: [], x: [] }] },
    { id: 'ash', n: 'ash', img: '', f: [{ n: 'ash', t: 'クリーチャー', c: 'F', co: 1, p: '1000', r: ['ブルー・コマンド・ドラゴン', '生徒会組'], x: ['各ターンに１度、自分のドラゴンが出た時、カードを１枚引いてもよい。'] }] },
    { id: 'drg', n: 'drg', img: '', f: [{ n: 'drg', t: 'クリーチャー', c: 'F', co: 1, p: '1000', r: ['アーマード・ドラゴン'], x: [] }] },
    cr('bp', 1, 1000, ['相手のターン中に、相手が召喚以外の方法でクリーチャーを出した時、そのクリーチャーを破壊する。']),
    cr('mach', 2, 3000, ['マッハファイター']),
    cr('rc', 5, 9000, ['革命チェンジ：火のクリーチャー（自分の火のクリーチャーが攻撃する時、そのクリーチャーと手札にあるこのクリーチャーを入れ替えてもよい）']),
    { id: 'mega', n: 'mega', img: '', f: [{ n: 'mega', t: 'クリーチャー', c: 'F', co: 1, p: '1000', r: ['メガ・コマンド・ドラゴン', '生徒会組'], x: ['自分の生徒会組すべてに「スピードアタッカー」を与える。'] }] },
    { id: 'seito', n: 'seito', img: '', f: [{ n: 'seito', t: 'クリーチャー', c: 'F', co: 1, p: '1000', r: ['生徒会組'], x: [] }] },
    cr('bakt', 1, 1000, ['自分の他のクリーチャーすべてに「ブロッカー」と「スピードアタッカー」を与える。']),
    { id: 'gale', n: 'gale', img: '', f: [{ n: 'gale', t: 'クリーチャー', c: 'F', co: 1, p: '1000', r: ['生徒会組'], x: ['自分の手札にある生徒会組カードすべてに「シンパシー：自分のドラゴン」を与える。'] }] },
    { id: 'seito7', n: 'seito7', img: '', f: [{ n: 'seito7', t: 'クリーチャー', c: 'F', co: 7, p: '7000', r: ['生徒会組'], x: [] }] },
    { id: 'kill', n: 'kill', img: '', f: [{ n: 'kill', t: '呪文', c: 'F', co: 1, p: null, r: [], x: ['相手のクリーチャーを1体破壊する。'] }] },
  ],
  { premium: [], hof: [], premiumCombos: [], premiumHyperCombos: [] },
  [],
);
const L = (cid: string) => db.byId.get(cid);

/** 指定のカードを各ゾーンに置いた2人対戦 (player 0 のメインステップ) */
function setup(zones: { p: number; cid: string; zone: 'hand' | 'battle' | 'mana'; tapped?: boolean }[], mana = 3): GameState {
  const extra = zones.map((z) => z.cid);
  let s = createGame(
    {
      mode: 'duema',
      seed: 1,
      createdAt: 0,
      players: [0, 1].map((p) => ({
        uid: 'u' + p,
        name: 'P' + p,
        cpu: false,
        main: [...Array(30).fill('vanilla'), ...extra.filter((_, i) => zones[i].p === p)],
        hyper: [],
        gr: [],
        partner: null,
      })),
    },
    L,
  );
  s = structuredClone(s);
  const used = new Set<number>();
  for (const z of zones) {
    const pl = s.players[z.p];
    let iid: number | undefined;
    for (const from of ['deck', 'shield', 'hand'] as const) {
      iid = pl[from].find((i) => s.cards[i].cid === z.cid && !used.has(i));
      if (iid != null) {
        pl[from].splice(pl[from].indexOf(iid), 1);
        break;
      }
    }
    if (iid == null) throw new Error('not found ' + z.cid);
    used.add(iid);
    s.cards[iid].zone = z.zone;
    s.cards[iid].tapped = !!z.tapped;
    s.cards[iid].sick = false;
    pl[z.zone].push(iid);
  }
  for (let p = 0; p < 2; p++)
    for (let i = 0; i < mana; i++) {
      const iid = s.players[p].deck.pop()!;
      s.cards[iid].zone = 'mana';
      s.players[p].mana.push(iid);
    }
  s.active = 0;
  s.pending = [];
  s.turnStep = 'main';
  return s;
}

function act(s: GameState, p: number, a: Action): GameState {
  const r = applyAction(s, p, a, L);
  if (r.error) throw new Error(r.error);
  return r.state;
}
const find = (s: GameState, p: number, zone: 'hand' | 'battle' | 'mana' | 'grave', cid: string) => s.players[p][zone].find((i) => s.cards[i].cid === cid);
const freeMana = (s: GameState, p: number, n: number, not?: number) => s.players[p].mana.filter((i) => !s.cards[i].tapped && i !== not).slice(0, n);

describe('named mechanics', () => {
  it('B・A・D: summons cheaper and is destroyed at end of turn', () => {
    let s = setup([{ p: 0, cid: 'bad', zone: 'hand' }]);
    const iid = find(s, 0, 'hand', 'bad')!;
    expect(applyAction(s, 0, { t: 'play', iid, face: 0, pay: freeMana(s, 0, 2) }, L).error).toBeTruthy();
    s = act(s, 0, { t: 'play', iid, face: 0, pay: freeMana(s, 0, 2), alt: 'bad' });
    expect(s.cards[iid].zone).toBe('battle');
    s = act(s, 0, { t: 'endTurn' });
    expect(s.cards[iid].zone).toBe('grave');
  });

  it('相手はマナをN枚までしかアンタップできない / 破壊される時かわりに山札の上', () => {
    let s = setup([{ p: 0, cid: 'ulim', zone: 'battle' }, { p: 0, cid: 'dante', zone: 'battle' }], 3);
    for (let i = 0; i < 4; i++) {
      const m = s.players[1].deck.pop()!;
      s.cards[m].zone = 'mana';
      s.cards[m].tapped = true;
      s.players[1].mana.push(m);
    }
    s = act(s, 0, { t: 'endTurn' });
    expect(s.players[1].mana.filter((m) => s.cards[m].tapped).length).toBe(2);
    const d = find(s, 0, 'battle', 'dante')!;
    moveCard(s, L, d, 'grave');
    expect(s.players[0].deck.at(-1)).toBe(d);
  });

  it('次に召喚するクリーチャーに「スピードアタッカー」 / 唱えた後山札に加えてシャッフル', () => {
    let s = setup([{ p: 0, cid: 'scrch', zone: 'hand' }, { p: 0, cid: 'bad', zone: 'hand' }], 5);
    const sp = find(s, 0, 'hand', 'scrch')!;
    s = act(s, 0, { t: 'play', iid: sp, face: 0, pay: freeMana(s, 0, 1) });
    while (s.pending.length) s = act(s, 0, { t: 'resolve' } as never);
    expect(s.cards[sp].zone).toBe('deck');
    const b = find(s, 0, 'hand', 'bad')!;
    s = act(s, 0, { t: 'play', iid: b, face: 0, pay: freeMana(s, 0, 3) });
    expect(s.cards[b].zone).toBe('battle');
    expect(canAttackWith(s, L, b)).toBe(true);
  });

  it('相手は次の自身のターンにクリーチャーを召喚できない', () => {
    let s = setup([{ p: 0, cid: 'slock', zone: 'hand' }, { p: 1, cid: 'vanilla', zone: 'hand' }], 3);
    const sp = find(s, 0, 'hand', 'slock')!;
    s = act(s, 0, { t: 'play', iid: sp, face: 0, pay: freeMana(s, 0, 1) });
    while (s.pending.length) s = act(s, 0, { t: 'resolve' } as never);
    s = act(s, 0, { t: 'endTurn' });
    while (s.pending.length && s.turnStep !== 'main') s = act(s, 1, { t: 'resolve' } as never);
    const v = find(s, 1, 'hand', 'vanilla')!;
    expect(applyAction(s, 1, { t: 'play', iid: v, face: 0, pay: freeMana(s, 1, 1) }, L).error).toBeTruthy();
    s = act(s, 1, { t: 'endTurn' });
    expect(s.players[1].summonLockUntil).toBeUndefined();
  });

  it('タップされていない光のクリーチャーを攻撃できる', () => {
    const s = setup([{ p: 0, cid: 'lightHunter', zone: 'battle' }, { p: 1, cid: 'lightMon', zone: 'battle' }, { p: 1, cid: 'vanilla', zone: 'battle' }]);
    const h = find(s, 0, 'battle', 'lightHunter')!;
    s.cards[h].sick = false;
    const t = attackTargets(s, L, h).cards;
    expect(t).toContain(find(s, 1, 'battle', 'lightMon'));
    expect(t).not.toContain(find(s, 1, 'battle', 'vanilla'));
  });

  it('他に自分のクリーチャーがなければ能力を得る (条件つきの付与)', () => {
    const s = setup([{ p: 0, cid: 'loneWB', zone: 'battle' }]);
    const w = find(s, 0, 'battle', 'loneWB')!;
    expect(kwOf(s, L, w).breaker).toBe(2);
    expect(kwOf(s, L, w).powerAttacker).toBe(3000);
    const v = s.players[0].deck.pop()!;
    s.cards[v].zone = 'battle';
    s.players[0].battle.push(v);
    expect(kwOf(s, L, w).breaker).toBeLessThan(2);
  });

  it('条件つきの「S・トリガー」はブレイクされた時に条件を見る', () => {
    for (const n of [1, 2]) {
      const s = setup(Array.from({ length: n }, () => ({ p: 0, cid: 'vanilla', zone: 'battle' as const })));
      const pl = s.players[1];
      const st = s.players[1].deck.findLast((i) => s.cards[i].cid === 'vanilla')!;
      s.cards[st].cid = 'condST';
      pl.deck.splice(pl.deck.indexOf(st), 1);
      s.cards[st].zone = 'shield';
      pl.shield.push(st);
      breakShields(s, L, 1, [st], 0);
      expect(s.pending.some((x) => x.kind === 'trigger' && x.iid === st)).toBe(n >= 2);
    }
  });

  it('このクリーチャーがタップしていれば、自分は攻撃されない', () => {
    const s = setup([{ p: 0, cid: 'vanilla', zone: 'battle' }, { p: 1, cid: 'tapGuard', zone: 'battle' }]);
    const a = find(s, 0, 'battle', 'vanilla')!;
    s.cards[a].sick = false;
    expect(attackTargets(s, L, a).players).toContain(1);
    s.cards[find(s, 1, 'battle', 'tapGuard')!].tapped = true;
    expect(attackTargets(s, L, a).players).not.toContain(1);
  });

  it('マナ爆誕: summons from the mana zone', () => {
    let s = setup([{ p: 0, cid: 'baku', zone: 'mana' }]);
    const iid = find(s, 0, 'mana', 'baku')!;
    s = act(s, 0, { t: 'play', iid, face: 0, pay: freeMana(s, 0, 3, iid), alt: 'mana' });
    expect(s.cards[iid].zone).toBe('battle');
  });

  it('エターナル・Ω: returns to hand instead of being destroyed', () => {
    let s = setup([
      { p: 0, cid: 'kill', zone: 'hand' },
      { p: 1, cid: 'omega', zone: 'battle' },
    ]);
    const om = find(s, 1, 'battle', 'omega')!;
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'kill')!, face: 0, pay: freeMana(s, 0, 1) });
    for (let k = 0; k < 5 && s.pending.length; k++) {
      const top = s.pending[0];
      if (top.kind === 'choice') s = act(s, top.player, { t: 'choose', picks: [om] });
      else if (top.kind === 'ability') s = act(s, top.player, { t: 'resolve', use: true });
      else break;
    }
    expect(s.cards[om].zone).toBe('hand');
  });

  it('ガードマン: redirects an attack on another creature', () => {
    let s = setup([
      { p: 0, cid: 'sa', zone: 'battle' },
      { p: 1, cid: 'vanilla', zone: 'battle', tapped: true },
      { p: 1, cid: 'guard', zone: 'battle' },
    ]);
    const sa = find(s, 0, 'battle', 'sa')!;
    const victim = s.players[1].battle.find((i) => s.cards[i].cid === 'vanilla')!;
    const g = find(s, 1, 'battle', 'guard')!;
    s = act(s, 0, { t: 'attack', attacker: sa, player: 1, card: victim });
    const top = s.pending[0];
    expect(top.kind).toBe('block');
    expect(top.kind === 'block' && top.guards).toContain(g);
    s = act(s, 1, { t: 'block', guard: g });
    // 3000 vs 6000 → アタッカーが負け、守られたクリーチャーは無事
    expect(s.cards[victim].zone).toBe('battle');
    expect(s.cards[sa].zone).toBe('grave');
  });

  it('ハイパー化: taps another creature and switches to the hyper face', () => {
    let s = setup([
      { p: 0, cid: 'hyper', zone: 'battle' },
      { p: 0, cid: 'vanilla', zone: 'battle' },
    ]);
    const h = find(s, 0, 'battle', 'hyper')!;
    const v = s.players[0].battle.find((i) => i !== h)!;
    s = act(s, 0, { t: 'hyperize', iid: h, taps: [v] });
    expect(s.cards[h].face).toBe(1);
    expect(s.cards[v].tapped).toBe(true);
    expect(power(s, L, h)).toBe(9000);
  });

  it('tap ability: taps instead of attacking and resolves the effect', () => {
    let s = setup([{ p: 0, cid: 'tapper', zone: 'battle' }]);
    const t = find(s, 0, 'battle', 'tapper')!;
    const hand = s.players[0].hand.length;
    s = act(s, 0, { t: 'tapAbility', iid: t });
    for (let k = 0; k < 3 && s.pending.length; k++) s = act(s, 0, { t: 'resolve', use: true });
    expect(s.cards[t].tapped).toBe(true);
    expect(s.players[0].hand.length).toBe(hand + 2);
  });

  it('サバイバー: other survivors share the oS ability', () => {
    const s = setup([
      { p: 0, cid: 'sv1', zone: 'battle' },
      { p: 0, cid: 'sv2', zone: 'battle' },
    ]);
    expect(power(s, L, find(s, 0, 'battle', 'sv1')!)).toBe(3000);
    expect(power(s, L, find(s, 0, 'battle', 'sv2')!)).toBe(3000);
  });

  it('ウェーブストライカー: needs two other wave strikers', () => {
    const two = setup([
      { p: 0, cid: 'wave', zone: 'battle' },
      { p: 0, cid: 'wave', zone: 'battle' },
    ]);
    expect(kwOf(two, L, two.players[0].battle[0]).breaker).toBe(1);
    const three = setup([
      { p: 0, cid: 'wave', zone: 'battle' },
      { p: 0, cid: 'wave', zone: 'battle' },
      { p: 1, cid: 'wave', zone: 'battle' },
    ]);
    expect(kwOf(three, L, three.players[0].battle[0]).breaker).toBe(2);
  });

  it('ムゲンクライム: taps two creatures and summons from the graveyard', () => {
    let s = setup([
      { p: 0, cid: 'mugen', zone: 'hand' },
      { p: 0, cid: 'vanilla', zone: 'battle' },
      { p: 0, cid: 'vanilla', zone: 'battle' },
    ]);
    const m = find(s, 0, 'hand', 'mugen')!;
    s = act(s, 0, { t: 'move', iid: m, to: 'grave' });
    const taps = s.players[0].battle.slice(0, 2);
    s = act(s, 0, { t: 'play', iid: m, face: 0, pay: freeMana(s, 0, 2), alt: 'mugen', taps });
    expect(s.cards[m].zone).toBe('battle');
    expect(taps.every((b) => s.cards[b].tapped)).toBe(true);
  });

  it('クロスギア: crosses onto a creature and stays when the creature leaves', () => {
    let s = setup([
      { p: 0, cid: 'gear', zone: 'battle' },
      { p: 0, cid: 'vanilla', zone: 'battle' },
    ]);
    const g = find(s, 0, 'battle', 'gear')!;
    const v = find(s, 0, 'battle', 'vanilla')!;
    s = act(s, 0, { t: 'cross', iid: g, onto: v, pay: freeMana(s, 0, 2) });
    expect(s.cards[g].parent).toBe(v);
    expect(power(s, L, v)).toBe(4000);
    s = act(s, 0, { t: 'move', iid: v, to: 'grave' });
    expect(s.cards[g].zone).toBe('battle');
  });

  it('覚醒 / 解除: flips up at turn start and flips back instead of leaving', () => {
    let s = setup([{ p: 0, cid: 'psy', zone: 'battle' }]);
    const ps = find(s, 0, 'battle', 'psy')!;
    const face = L('psy')!.faces;
    expect(face[0].triggers.length).toBe(1);
    expect(face[1].statics.some((x) => x.s === 'release')).toBe(true);
    s.cards[ps].face = 1;
    s = act(s, 0, { t: 'move', iid: ps, to: 'grave' });
    expect(s.cards[ps].zone).toBe('battle');
    expect(s.cards[ps].face).toBe(0);
  });

  it('G・リンク: links gods into one creature with summed power', () => {
    let s = setup([
      { p: 0, cid: 'godA', zone: 'battle' },
      { p: 0, cid: 'godB', zone: 'hand' },
    ]);
    const a = find(s, 0, 'battle', 'godA')!;
    const b = find(s, 0, 'hand', 'godB')!;
    s = act(s, 0, { t: 'play', iid: b, face: 0, pay: freeMana(s, 0, 3) });
    expect(s.cards[b].linkedTo).toBe(a);
    expect(power(s, L, a)).toBe(7000);
    expect(kwOf(s, L, a).breaker).toBe(2);
    s = act(s, 0, { t: 'move', iid: a, to: 'grave' });
    expect(s.cards[b].zone).toBe('battle');
  });

  it('龍解: equipped dragheart flips to a creature at end of turn if the holder is tapped', () => {
    let s = setup([
      { p: 0, cid: 'dh', zone: 'battle' },
      { p: 0, cid: 'vanilla', zone: 'battle', tapped: true },
    ]);
    const d = find(s, 0, 'battle', 'dh')!;
    const v = find(s, 0, 'battle', 'vanilla')!;
    s = act(s, 0, { t: 'stack', iid: d, onto: v });
    s = act(s, 0, { t: 'endTurn' });
    for (let k = 0; k < 5 && s.pending.length; k++) s = act(s, s.pending[0].player, { t: 'resolve', use: true });
    expect(s.cards[d].zone).toBe('battle');
    expect(s.cards[d].face).toBe(1);
  });

  it('ギャラクシールド: becomes a face-up shield and is summoned at turn start', () => {
    let s = setup([{ p: 0, cid: 'galaxy', zone: 'hand' }]);
    const g = find(s, 0, 'hand', 'galaxy')!;
    s = act(s, 0, { t: 'play', iid: g, face: 0, pay: freeMana(s, 0, 3), alt: 'galaxy' });
    expect(s.cards[g].zone).toBe('shield');
    expect(s.cards[g].faceUp).toBe(true);
    s = act(s, 0, { t: 'endTurn' });
    for (let k = 0; k < 8 && s.cards[g].zone !== 'battle'; k++) {
      const top = s.pending[0];
      if (top) s = act(s, top.player, { t: 'resolve', use: true });
      else s = act(s, s.active, { t: 'endTurn' });
    }
    expect(s.cards[g].zone).toBe('battle');
  });

  it('フシギバース: puts a creature into mana and summons from the graveyard', () => {
    let s = setup([
      { p: 0, cid: 'fushigi', zone: 'hand' },
      { p: 0, cid: 'big', zone: 'battle' },
    ]);
    const f = find(s, 0, 'hand', 'fushigi')!;
    const b = find(s, 0, 'battle', 'big')!;
    s = act(s, 0, { t: 'move', iid: f, to: 'grave' });
    s = act(s, 0, { t: 'play', iid: f, face: 0, pay: freeMana(s, 0, 3), alt: 'fushigi', taps: [b] });
    expect(s.cards[f].zone).toBe('battle');
    expect(s.cards[b].zone).toBe('mana');
  });

  it('エグザイル: cannot have two exiles sharing the name', () => {
    const s = setup([
      { p: 0, cid: 'ex1', zone: 'battle' },
      { p: 0, cid: 'ex2', zone: 'hand' },
    ]);
    expect(applyAction(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'ex2')!, face: 0, pay: freeMana(s, 0, 1) }, L).error).toMatch(/エグザイル/);
  });

  it('アタック・チャンス: offers to cast the spell for free when attacking', () => {
    let s = setup([
      { p: 0, cid: 'sa', zone: 'battle' },
      { p: 0, cid: 'chance', zone: 'hand' },
    ]);
    const ch = find(s, 0, 'hand', 'chance')!;
    s = act(s, 0, { t: 'attack', attacker: find(s, 0, 'battle', 'sa')!, player: 1 });
    for (let k = 0; k < 6 && s.cards[ch].zone === 'hand' && s.pending.length; k++) {
      const top = s.pending[0];
      if (top.player !== 0) break;
      s = act(s, 0, top.kind === 'choice' ? { t: 'choose', yes: true, picks: [], options: [0] } : top.kind === 'ability' ? { t: 'resolve', use: true } : { t: 'attackOpt', iid: null });
    }
    expect(s.cards[ch].zone).toBe('grave');
  });

  it('スペース・チャージ: uses only the q ability matching the civilization of the card put into mana', () => {
    let s = setup([
      { p: 0, cid: 'space2', zone: 'battle' },
      { p: 0, cid: 'vanilla', zone: 'hand' },
    ]);
    const hand = s.players[0].hand.length;
    s = act(s, 0, { t: 'charge', iid: find(s, 0, 'hand', 'vanilla')! });
    for (let k = 0; k < 6 && s.pending.length; k++) {
      const top = s.pending[0];
      s = act(s, top.player, top.kind === 'choice' ? { t: 'choose', yes: true, picks: [], options: [0] } : { t: 'resolve', use: true });
    }
    expect(s.players[0].hand.length).toBe(hand + 1);
  });

  it('無月の門: summons from the graveyard on top of 2+2 魔導具', () => {
    let s = setup([
      { p: 0, cid: 'md', zone: 'battle' },
      { p: 0, cid: 'md', zone: 'hand' },
      { p: 0, cid: 'md', zone: 'mana' },
      { p: 0, cid: 'md', zone: 'mana' },
      { p: 0, cid: 'mug', zone: 'mana' },
    ]);
    // 2枚の魔導具と mug を墓地へ
    for (const cid of ['md', 'md', 'mug']) {
      const i = s.players[0].mana.find((m) => s.cards[m].cid === cid)!;
      s.players[0].mana.splice(s.players[0].mana.indexOf(i), 1);
      s.cards[i].zone = 'grave';
      s.players[0].grave.push(i);
    }
    const mug = find(s, 0, 'grave', 'mug')!;
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'md')!, face: 0, pay: freeMana(s, 0, 1) });
    for (let k = 0; k < 6 && s.pending.length; k++) {
      const top = s.pending[0];
      s = act(s, top.player, top.kind === 'choice' ? { t: 'choose', yes: true, picks: [], options: [0] } : { t: 'resolve', use: true });
    }
    expect(s.cards[mug].zone).toBe('battle');
    expect(s.cards[mug].under.length).toBe(4);
    expect(s.players[0].battle.length).toBe(1);
  });

  it('各プレイヤーは: each player chooses for themselves', () => {
    let s = setup([{ p: 0, cid: 'eachSp', zone: 'hand' }]);
    const h0 = s.players[0].hand.length;
    const h1 = s.players[1].hand.length;
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'eachSp')!, face: 0, pay: freeMana(s, 0, 1) });
    const choosers: number[] = [];
    for (let k = 0; k < 8 && s.pending.length; k++) {
      const top = s.pending[0];
      if (top.kind === 'choice') choosers.push(top.player);
      s = act(s, top.player, top.kind === 'choice' ? { t: 'choose', yes: true, picks: top.options.slice(0, 1), options: [0] } : { t: 'resolve', use: true });
    }
    expect(choosers).toEqual([0, 1]);
    expect(s.players[0].hand.length).toBe(h0 - 1 + 1);
    expect(s.players[1].hand.length).toBe(h1 + 1);
  });

  it('このターン、自分のクリーチャーが攻撃する時: temporary trigger fires on attack', () => {
    let s = setup([
      { p: 0, cid: 'tmpSp', zone: 'hand' },
      { p: 0, cid: 'sa', zone: 'battle' },
    ]);
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'tmpSp')!, face: 0, pay: freeMana(s, 0, 1) });
    for (let k = 0; k < 4 && s.pending.length; k++) s = act(s, s.pending[0].player, { t: 'resolve', use: true });
    const hand = s.players[0].hand.length;
    s = act(s, 0, { t: 'attack', attacker: find(s, 0, 'battle', 'sa')!, player: 1 });
    expect(s.players[0].hand.length).toBe(hand + 1);
  });

  it('シンカパワー: the base creature ability resolves when evolved', () => {
    let s = setup([
      { p: 0, cid: 'sinka', zone: 'battle' },
      { p: 0, cid: 'evo1', zone: 'hand' },
    ]);
    const hand = s.players[0].hand.length;
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'evo1')!, face: 0, pay: freeMana(s, 0, 1), evo: [find(s, 0, 'battle', 'sinka')!] });
    for (let k = 0; k < 4 && s.pending.length; k++) s = act(s, s.pending[0].player, { t: 'resolve', use: true });
    expect(s.players[0].hand.length).toBe(hand - 1 + 1);
  });

  it('フォートE: gains the next ability when summoned by tapping that race in mana', () => {
    let s = setup([{ p: 0, cid: 'fort', zone: 'hand' }]);
    const iid = find(s, 0, 'hand', 'fort')!;
    s = act(s, 0, { t: 'play', iid, face: 0, pay: freeMana(s, 0, 1) });
    for (let k = 0; k < 4 && s.pending.length; k++) s = act(s, s.pending[0].player, { t: 'resolve', use: true });
    expect(power(s, L, iid)).toBe(6000);
  });

  it('輪廻∞: casts the spell side while staying in the battle zone', () => {
    let s = setup([{ p: 0, cid: 'rin', zone: 'battle' }]);
    const iid = find(s, 0, 'battle', 'rin')!;
    const hand = s.players[0].hand.length;
    s = act(s, 0, { t: 'rinne', iid });
    for (let k = 0; k < 4 && s.pending.length; k++) s = act(s, s.pending[0].player, { t: 'resolve', use: true });
    expect(s.cards[iid].zone).toBe('battle');
    expect(s.players[0].hand.length).toBe(hand + 2);
    expect(s.players[0].mana.filter((m) => s.cards[m].tapped).length).toBe(1);
  });

  it('無月の門能力を使った時: a graveyard creature comes back tapped', () => {
    let s = setup([
      { p: 0, cid: 'md', zone: 'battle' },
      { p: 0, cid: 'md', zone: 'hand' },
      { p: 0, cid: 'md', zone: 'mana' },
      { p: 0, cid: 'md', zone: 'mana' },
      { p: 0, cid: 'mug', zone: 'mana' },
      { p: 0, cid: 'hakuyon', zone: 'mana' },
    ]);
    for (const cid of ['md', 'md', 'mug', 'hakuyon']) {
      const i = s.players[0].mana.find((m) => s.cards[m].cid === cid)!;
      s.players[0].mana.splice(s.players[0].mana.indexOf(i), 1);
      s.cards[i].zone = 'grave';
      s.players[0].grave.push(i);
    }
    const hk = find(s, 0, 'grave', 'hakuyon')!;
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'md')!, face: 0, pay: freeMana(s, 0, 1) });
    for (let k = 0; k < 8 && s.pending.length; k++) {
      const top = s.pending[0];
      s = act(s, top.player, top.kind === 'choice' ? { t: 'choose', yes: true, picks: [], options: [0] } : { t: 'resolve', use: true });
    }
    expect(s.cards[hk].zone).toBe('battle');
    expect(s.cards[hk].tapped).toBe(true);
  });

  it('墓地に置かれる直前に進化クリーチャーの下にあった場合: draws when the evolution is destroyed', () => {
    let s = setup([
      { p: 0, cid: 'ebase', zone: 'battle' },
      { p: 0, cid: 'evo1', zone: 'hand' },
    ]);
    const base = find(s, 0, 'battle', 'ebase')!;
    const evo = find(s, 0, 'hand', 'evo1')!;
    s = act(s, 0, { t: 'play', iid: evo, face: 0, pay: freeMana(s, 0, 1), evo: [base] });
    for (let k = 0; k < 4 && s.pending.length; k++) s = act(s, s.pending[0].player, { t: 'resolve', use: true });
    const hand = s.players[0].hand.length;
    s = act(s, 0, { t: 'move', iid: evo, to: 'grave' });
    for (let k = 0; k < 6 && s.pending.length; k++) {
      const top = s.pending[0];
      s = act(s, top.player, top.kind === 'choice' ? { t: 'choose', yes: true, picks: [], options: [0] } : { t: 'resolve', use: true });
    }
    expect(s.cards[base].zone).toBe('grave');
    expect(s.players[0].hand.length).toBe(hand + 1);
  });

  it('デュエリスト: placed at game start and executes a duel mate once per turn', () => {
    const g = createGame({ mode: 'duema', seed: 3, createdAt: 0, players: [0, 1].map((p) => ({ uid: 'u' + p, name: 'P' + p, cpu: false, main: Array(40).fill('vanilla'), hyper: p === 0 ? ['dl', 'dm', 'dm'] : [], gr: [], partner: null })) } as never, L);
    let s = structuredClone(g);
    const dl = s.players[0].partner[0];
    expect(s.cards[dl].zone).toBe('partner');
    for (let i = 0; i < 3; i++) {
      const m = s.players[0].deck.pop()!;
      s.cards[m].zone = 'mana';
      s.players[0].mana.push(m);
    }
    s.active = 0;
    s.pending = [];
    s.turnStep = 'main';
    const t = s.players[0].hyper[0];
    s = act(s, 0, { t: 'duelist', iid: dl, target: t });
    expect(s.cards[t].zone).toBe('battle');
    expect(applyAction(s, 0, { t: 'duelist', iid: dl, target: s.players[0].hyper[0] }, L).error).toBeTruthy();
  });

  it('デュエリスト・リンク: 3 duel mates link, can attack, leave replaced by destroying the duelist', () => {
    const g = createGame({ mode: 'duema', seed: 3, createdAt: 0, players: [0, 1].map((p) => ({ uid: 'u' + p, name: 'P' + p, cpu: false, main: Array(40).fill('vanilla'), hyper: p === 0 ? ['dl2', 'lm1', 'lm2', 'lm3', 'dsp'] : [], gr: [], partner: null })) } as never, L);
    let s = structuredClone(g);
    const dl = s.players[0].partner[0];
    for (let i = 0; i < 10; i++) {
      const m = s.players[0].deck.pop()!;
      s.cards[m].zone = 'mana';
      s.players[0].mana.push(m);
    }
    s.active = 0;
    s.pending = [];
    s.turnStep = 'main';
    const sp = s.players[0].hyper.find((h) => s.cards[h].cid === 'dsp')!;
    s = act(s, 0, { t: 'duelist', iid: dl, target: sp });
    expect(s.cards[sp].zone).toBe('under');
    expect(s.cards[dl].under).toContain(sp);
    for (const id of ['lm1', 'lm2', 'lm3']) {
      s.players[0].duelistTurn = undefined;
      s = act(s, 0, { t: 'duelist', iid: dl, target: s.players[0].hyper.find((h) => s.cards[h].cid === id)! });
    }
    expect(s.players[0].battle.length).toBe(1);
    const sup = s.players[0].battle[0];
    expect(s.cards[sup].face).toBe(1);
    expect(s.cards[sup].under.length).toBe(2);
    expect(canAttackWith(s, L, sup)).toBe(true);
    moveCard(s, L, sup, 'grave');
    expect(s.cards[sup].zone).toBe('battle');
    expect(s.cards[dl].zone).not.toBe('partner');
  });

  it('零龍: placed at game start and 零龍卍誕 after 4 links', () => {
    const g = createGame({ mode: 'duema', seed: 3, createdAt: 0, players: [0, 1].map((p) => ({ uid: 'u' + p, name: 'P' + p, cpu: false, main: Array(40).fill('vanilla'), hyper: p === 0 ? ['zero', 'st1', 'st2', 'st3', 'st4'] : [], gr: [], partner: null })) } as never, L);
    let s = structuredClone(g);
    const zero = s.players[0].battle.find((b) => s.cards[b].cid === 'zero')!;
    expect(s.players[0].battle.length).toBe(5);
    expect(s.players[1].hand.length).toBe(6);
    s.active = 0;
    s.pending = [];
    s.turnStep = 'main';
    for (const st of s.players[0].battle.filter((b) => b !== zero)) {
      startExec(s, L, 0, st, programOf('この零龍星雲を自分の《zero》にリンクしてもよい').ops, 'st');
      for (let k = 0; k < 6 && s.pending.length; k++) {
        const top = s.pending[0];
        s = act(s, top.player, top.kind === 'choice' ? { t: 'choose', yes: true, picks: [], options: [0] } : { t: 'resolve', use: true });
      }
    }
    expect(s.cards[zero].face).toBe(1);
    expect(s.players[0].battle).toEqual([zero]);
  });

  it('各ターンに1度、自分のドラゴンが出た時: includes itself and fires once per turn per card', () => {
    let s = setup([
      { p: 0, cid: 'ash', zone: 'battle' },
      { p: 0, cid: 'ash', zone: 'hand' },
      { p: 0, cid: 'drg', zone: 'hand' },
    ], 4);
    const resolveAll = () => {
      for (let k = 0; k < 8 && s.pending.length; k++) {
        const top = s.pending[0];
        s = act(s, top.player, top.kind === 'choice' ? { t: 'choose', yes: true, picks: [], options: [0] } : { t: 'resolve', use: true });
      }
    };
    const h0 = s.players[0].hand.length;
    // 2体目のashが出る: 自分自身と、場のash の両方が誘発 (2枚引く)
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'ash')!, face: 0, pay: freeMana(s, 0, 1) });
    resolveAll();
    expect(s.players[0].hand.length).toBe(h0 - 1 + 2);
    // 同じターンに別のドラゴンが出ても、もう誘発しない
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'drg')!, face: 0, pay: freeMana(s, 0, 1) });
    resolveAll();
    expect(s.players[0].hand.length).toBe(h0 - 2 + 2);
  });

  it('召喚以外の方法で出た時: does not trigger on summon', () => {
    let s = setup([
      { p: 1, cid: 'bp', zone: 'battle' },
      { p: 0, cid: 'sa', zone: 'hand' },
      { p: 0, cid: 'drg', zone: 'hand' },
    ]);
    const resolveAll = () => {
      for (let k = 0; k < 8 && s.pending.length; k++) {
        const top = s.pending[0];
        s = act(s, top.player, top.kind === 'choice' ? { t: 'choose', yes: true, picks: [], options: [0] } : { t: 'resolve', use: true });
      }
    };
    const a = find(s, 0, 'hand', 'sa')!;
    s = act(s, 0, { t: 'play', iid: a, face: 0, pay: freeMana(s, 0, 1) });
    resolveAll();
    expect(s.cards[a].zone).toBe('battle');
    const b = find(s, 0, 'hand', 'drg')!;
    s = act(s, 0, { t: 'move', iid: b, to: 'battle' });
    resolveAll();
    expect(s.cards[b].zone).toBe('grave');
  });

  it('マッハファイターでクリーチャーを攻撃する時も革命チェンジできる', () => {
    let s = setup([
      { p: 0, cid: 'mach', zone: 'battle' },
      { p: 0, cid: 'rc', zone: 'hand' },
      { p: 1, cid: 'vanilla', zone: 'battle' },
    ]);
    const m = find(s, 0, 'battle', 'mach')!;
    s.cards[m].sick = true;
    s = act(s, 0, { t: 'attack', attacker: m, player: 1, card: find(s, 1, 'battle', 'vanilla')! });
    expect(s.pending[0]?.kind).toBe('attackOpt');
    const rc = find(s, 0, 'hand', 'rc')!;
    const target = find(s, 1, 'battle', 'vanilla')!;
    s = act(s, 0, { t: 'attackOpt', iid: rc });
    for (let k = 0; k < 10 && s.pending.length; k++) {
      const top = s.pending[0];
      s = act(s, top.player, top.kind === 'block' ? { t: 'block', blocker: null } : top.kind === 'choice' ? { t: 'choose', yes: true, picks: [], options: [0] } : { t: 'resolve', use: true });
    }
    expect(s.cards[rc].zone).toBe('battle');
    expect(s.cards[target].zone).toBe('grave');
  });

  it('他のクリーチャーに能力を与える: スピードアタッカー・ブロッカー・手札へのシンパシー', () => {
    const s = setup([
      { p: 0, cid: 'mega', zone: 'battle' },
      { p: 0, cid: 'seito', zone: 'battle' },
      { p: 0, cid: 'bakt', zone: 'battle' },
      { p: 0, cid: 'vanilla', zone: 'battle' },
      { p: 0, cid: 'gale', zone: 'battle' },
      { p: 0, cid: 'seito7', zone: 'hand' },
    ]);
    const seito = find(s, 0, 'battle', 'seito')!;
    const van = find(s, 0, 'battle', 'vanilla')!;
    s.cards[seito].sick = true;
    s.cards[van].sick = true;
    expect(canAttackWith(s, L, seito)).toBe(true);
    expect(canAttackWith(s, L, van)).toBe(true);
    expect(kwOf(s, L, van).blocker).toBe(true);
    // 手札の生徒会組にシンパシー: 場のドラゴン (mega) 1体につき1少なく
    const h = find(s, 0, 'hand', 'seito7')!;
    expect(costOf(s, L, 0, h, 0)).toBe(6);
  });

  it('Jビッグ: uses the enter ability of another Jokers creature', () => {
    let s = setup([
      { p: 0, cid: 'jokA', zone: 'battle' },
      { p: 0, cid: 'jbig', zone: 'hand' },
    ]);
    const iid = find(s, 0, 'hand', 'jbig')!;
    const hand = s.players[0].hand.length;
    s = act(s, 0, { t: 'play', iid, face: 0, pay: freeMana(s, 0, 1) });
    for (let k = 0; k < 8 && s.pending.length; k++) {
      const top = s.pending[0];
      s = act(s, top.player, top.kind === 'choice' ? { t: 'choose', yes: true, picks: top.options.slice(0, 1), options: [0] } : { t: 'resolve', use: true });
    }
    expect(s.players[0].hand.length).toBe(hand - 1 + 2);
  });

  it('modal "同じものを選んでもよい" allows picking the same option twice', () => {
    const p = programOf('次の中から2回選ぶ。(同じものを選んでもよい)▼カードを1枚引く。▼相手のクリーチャーを1体破壊する。');
    expect(p.complete).toBe(true);
    expect(p.ops.filter((o) => o.op === 'modal').length).toBe(2);
  });

  it('相手は各ターン1度しか攻撃できない', () => {
    let s = setup([
      { p: 0, cid: 'sa', zone: 'battle' },
      { p: 0, cid: 'vanilla', zone: 'battle' },
    ]);
    s.players[0].actLimit = { until: 1, n: 1, turn: -1, atk: 0, blk: 0 };
    s = act(s, 0, { t: 'attack', attacker: find(s, 0, 'battle', 'sa')!, player: 1 });
    expect(s.players[0].actLimit?.atk).toBe(1);
    expect(canAttackWith(s, L, find(s, 0, 'battle', 'vanilla')!)).toBe(false);
  });

  it('スペース・チャージ: uses the q ability when a matching card goes to mana', () => {
    let s = setup([
      { p: 0, cid: 'space', zone: 'battle' },
      { p: 0, cid: 'vanilla', zone: 'hand' },
    ]);
    const hand = s.players[0].hand.length;
    s = act(s, 0, { t: 'charge', iid: find(s, 0, 'hand', 'vanilla')! });
    for (let k = 0; k < 6 && s.pending.length; k++) {
      const top = s.pending[0];
      s = act(s, top.player, top.kind === 'choice' ? { t: 'choose', yes: true, picks: [], options: [0] } : { t: 'resolve', use: true });
    }
    expect(s.players[0].hand.length).toBe(hand);
  });

  it('D・D・D: can be used from hand by paying its cost when a creature attacks', () => {
    let s = setup([
      { p: 0, cid: 'sa', zone: 'battle' },
      { p: 0, cid: 'ddd', zone: 'hand' },
    ]);
    const d = find(s, 0, 'hand', 'ddd')!;
    s = act(s, 0, { t: 'attack', attacker: find(s, 0, 'battle', 'sa')!, player: 1 });
    for (let k = 0; k < 6 && s.cards[d].zone === 'hand' && s.pending.length; k++) {
      const top = s.pending[0];
      if (top.player !== 0) break;
      s = act(s, 0, top.kind === 'choice' ? { t: 'choose', yes: true, picks: [], options: [0] } : top.kind === 'ability' ? { t: 'resolve', use: true } : { t: 'attackOpt', iid: null });
    }
    expect(s.cards[d].zone).toBe('battle');
    expect(s.players[0].mana.filter((m) => s.cards[m].tapped).length).toBe(2);
  });

  it('可能なら攻撃する / 可能ならこのクリーチャーを攻撃する', () => {
    const s = setup([
      { p: 0, cid: 'must', zone: 'battle' },
      { p: 1, cid: 'lure', zone: 'battle', tapped: true },
    ]);
    const m = find(s, 0, 'battle', 'must')!;
    expect(applyAction(s, 0, { t: 'endTurn' }, L).error).toMatch(/攻撃しなければ/);
    expect(applyAction(s, 0, { t: 'attack', attacker: m, player: 1 }, L).error).toMatch(/攻撃しなければ/);
    expect(applyAction(s, 0, { t: 'attack', attacker: m, player: 1, card: find(s, 1, 'battle', 'lure')! }, L).error).toBeNull();
  });

  it('Jチェンジ: swaps with a joker in the mana zone', () => {
    let s = setup([
      { p: 0, cid: 'jc', zone: 'battle' },
      { p: 0, cid: 'jm', zone: 'mana' },
    ]);
    const jc = find(s, 0, 'battle', 'jc')!;
    const jm = find(s, 0, 'mana', 'jm')!;
    s = act(s, 0, { t: 'attack', attacker: jc, player: 1 });
    for (let k = 0; k < 8 && s.cards[jm].zone !== 'battle' && s.pending.length; k++) {
      const top = s.pending[0];
      if (top.player !== 0) break;
      s = act(s, 0, top.kind === 'choice' ? (top.mode === 'yesno' ? { t: 'choose', yes: true, picks: [], options: [0] } : { t: 'choose', picks: [jm] }) : top.kind === 'ability' ? { t: 'resolve', use: true } : { t: 'attackOpt', iid: null });
    }
    expect(s.cards[jm].zone).toBe('battle');
    expect(s.cards[jc].zone).toBe('mana');
  });

  it('覚醒リンク / リンク解除', () => {
    let s = setup([
      { p: 0, cid: 'cellA', zone: 'battle' },
      { p: 0, cid: 'cellB', zone: 'battle' },
    ]);
    const a = find(s, 0, 'battle', 'cellA')!;
    const b = find(s, 0, 'battle', 'cellB')!;
    s = act(s, 0, { t: 'endTurn' });
    for (let k = 0; k < 10 && s.cards[a].face === 0; k++) {
      const top = s.pending[0];
      if (top) s = act(s, top.player, top.kind === 'choice' ? { t: 'choose', yes: true, picks: [], options: [0] } : { t: 'resolve', use: true });
      else s = act(s, s.active, { t: 'endTurn' });
    }
    expect(s.cards[a].face).toBe(1);
    expect(s.cards[b].cellOf).toBe(a);
    expect(power(s, L, a)).toBe(20000);
    s.active = 0;
    s.pending = [];
    s = act(s, 0, { t: 'move', iid: a, to: 'grave' });
    expect(s.cards[a].zone).toBe('hyper');
    expect(s.cards[b].zone).toBe('battle');
    expect(s.cards[b].face).toBe(0);
  });

  it('サイレントスキル: stays tapped and uses the ability instead of untapping', () => {
    let s = setup([{ p: 0, cid: 'silent', zone: 'battle', tapped: true }]);
    const sl = find(s, 0, 'battle', 'silent')!;
    s = act(s, 0, { t: 'endTurn' });
    // 相手のターンを終える
    for (let k = 0; k < 6 && s.active !== 0; k++) s = act(s, s.active, s.pending.length ? { t: 'resolve', use: true } : { t: 'endTurn' });
    const hand = s.players[0].hand.length;
    const top = s.pending[0];
    expect(top?.kind).toBe('choice');
    s = act(s, 0, { t: 'choose', yes: true, picks: [], options: [0] });
    expect(s.cards[sl].tapped).toBe(true);
    expect(s.players[0].hand.length).toBeGreaterThanOrEqual(hand + 2);
  });

  it('オーラ: attaches to a GR creature and grants パワード・ブレイカー', () => {
    let s = setup([
      { p: 0, cid: 'aura', zone: 'hand' },
      { p: 0, cid: 'grc', zone: 'battle' },
    ]);
    const g = find(s, 0, 'battle', 'grc')!;
    const au = find(s, 0, 'hand', 'aura')!;
    s = act(s, 0, { t: 'play', iid: au, face: 0, pay: freeMana(s, 0, 2), evo: [g] });
    expect(s.cards[au].parent).toBe(g);
    expect(power(s, L, g)).toBe(8000);
    expect(breakCount(s, L, g)).toBe(2);
  });

  it('マーシャル・タッチ: returning another creature uses its own ability', () => {
    let s = setup([
      { p: 0, cid: 'marshal', zone: 'hand' },
      { p: 0, cid: 'vanilla', zone: 'battle' },
    ]);
    const v = find(s, 0, 'battle', 'vanilla')!;
    const hand = s.players[0].hand.length;
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'marshal')!, face: 0, pay: freeMana(s, 0, 3) });
    for (let k = 0; k < 8 && s.pending.length; k++) {
      const top = s.pending[0];
      s = act(s, top.player, top.kind === 'choice' ? (top.mode === 'yesno' ? { t: 'choose', yes: true, picks: [], options: [0] } : { t: 'choose', picks: [v] }) : { t: 'resolve', use: true });
    }
    expect(s.cards[v].zone).toBe('hand');
    // 手札: -1 (召喚) +1 (戻した) +2 (能力)
    expect(s.players[0].hand.length).toBe(hand + 2);
  });

  it('メタモーフ: gains the ability with 7+ mana', () => {
    const few = setup([{ p: 0, cid: 'meta', zone: 'battle' }], 3);
    expect(kwOf(few, L, find(few, 0, 'battle', 'meta')!).breaker).toBe(1);
    const many = setup([{ p: 0, cid: 'meta', zone: 'battle' }], 7);
    expect(kwOf(many, L, find(many, 0, 'battle', 'meta')!).breaker).toBe(2);
  });

  it('サイクロン: returns to hand when a creature was summoned right before', () => {
    let s = setup([
      { p: 0, cid: 'vanilla', zone: 'hand' },
      { p: 0, cid: 'cyc', zone: 'hand' },
    ]);
    const cy = find(s, 0, 'hand', 'cyc')!;
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'vanilla')!, face: 0, pay: freeMana(s, 0, 1) });
    s = act(s, 0, { t: 'play', iid: cy, face: 0, pay: freeMana(s, 0, 1) });
    expect(s.cards[cy].zone).toBe('hand');
  });

  it('爆進ダブル: both options are allowed only with an evolution creature', () => {
    const f = L('baku2')!.faces[0];
    const prog = programOf(spellEffectLines(f.text).join('。'));
    const mod = prog.ops.find((o) => o.op === 'modal');
    expect(mod && mod.op === 'modal' && mod.bonus).toBeTruthy();
  });

  it('エターナル・Κ / 水晶ソウル / 裏向きのマナ', () => {
    let s = setup([
      { p: 0, cid: 'ek', zone: 'battle' },
      { p: 0, cid: 'crystal', zone: 'hand' },
    ], 4);
    const mana = s.players[0].mana;
    for (const m of mana.slice(0, 3)) s.cards[m].manaDown = true;
    const ek = find(s, 0, 'battle', 'ek')!;
    s = act(s, 0, { t: 'move', iid: ek, to: 'grave' });
    expect(s.cards[ek].zone).toBe('battle');
    expect(mana.every((m) => !s.cards[m].manaDown)).toBe(true);
    // 水晶ソウル: 裏向き1枚(3) + 表向き3枚 = 6
    s.cards[mana[0]].manaDown = true;
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'crystal')!, face: 0, pay: mana.slice(0, 4) });
    expect(find(s, 0, 'battle', 'crystal')).toBeDefined();
  });

  it('マナゾーンのカードを裏向きにする', () => {
    let s = setup([{ p: 0, cid: 'downer', zone: 'hand' }]);
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'downer')!, face: 0, pay: freeMana(s, 0, 1) });
    for (let k = 0; k < 6 && s.pending.length; k++) {
      const top = s.pending[0];
      s = act(s, top.player, top.kind === 'choice' ? (top.mode === 'yesno' ? { t: 'choose', yes: true, picks: [], options: [0] } : { t: 'choose', picks: [s.players[0].mana[1]] }) : { t: 'resolve', use: true });
    }
    expect(s.players[0].mana.filter((m) => s.cards[m].manaDown).length).toBe(1);
  });

  it('破壊される時、かわりに自分の他のクリーチャーを破壊する', () => {
    let s = setup([
      { p: 0, cid: 'repl', zone: 'battle' },
      { p: 0, cid: 'vanilla', zone: 'battle' },
    ]);
    const r = find(s, 0, 'battle', 'repl')!;
    const v = find(s, 0, 'battle', 'vanilla')!;
    s = act(s, 0, { t: 'move', iid: r, to: 'grave' });
    for (let k = 0; k < 4 && s.pending.length; k++) {
      const top = s.pending[0];
      s = act(s, top.player, top.kind === 'choice' ? { t: 'choose', picks: [v] } : { t: 'resolve', use: true });
    }
    expect(s.cards[r].zone).toBe('battle');
    expect(s.cards[v].zone).toBe('grave');
  });

  it('シールド・ゴー: becomes a face-up shield when destroyed, and goes to the graveyard when it leaves', () => {
    let s = setup([{ p: 0, cid: 'sgo', zone: 'battle' }]);
    const g = find(s, 0, 'battle', 'sgo')!;
    s = act(s, 0, { t: 'move', iid: g, to: 'grave' });
    for (let k = 0; k < 4 && s.pending.length; k++) s = act(s, s.pending[0].player, { t: 'resolve', use: true });
    expect(s.cards[g].zone).toBe('shield');
    expect(s.cards[g].faceUp).toBe(true);
    s = act(s, 0, { t: 'move', iid: g, to: 'hand' });
    expect(s.cards[g].zone).toBe('grave');
  });

  it('マナ進化 / ソウルシフト', () => {
    let s = setup([
      { p: 0, cid: 'manaevo', zone: 'hand' },
      { p: 0, cid: 'big', zone: 'mana' },
      { p: 0, cid: 'shift', zone: 'hand' },
    ]);
    const me = find(s, 0, 'hand', 'manaevo')!;
    const base = find(s, 0, 'mana', 'big')!;
    s = act(s, 0, { t: 'play', iid: me, face: 0, pay: freeMana(s, 0, 2, base), evo: [base] });
    expect(s.cards[me].zone).toBe('battle');
    expect(s.cards[base].parent).toBe(me);
    // ソウルシフト: コスト7 - 進化元のコスト2 = 5 (マナ3枚では足りない → 2枚で出せない、を確認)
    const sh = find(s, 0, 'hand', 'shift')!;
    const err = applyAction(s, 0, { t: 'play', iid: sh, face: 0, pay: [], evo: [me], free: false }, L).error;
    expect(err).toMatch(/コスト5/);
  });

  it('種族を選ぶ: the chosen race filters later selections', () => {
    let s = setup([
      { p: 0, cid: 'pickrace', zone: 'hand' },
      { p: 0, cid: 'drg', zone: 'battle' },
    ]);
    const d = find(s, 0, 'battle', 'drg')!;
    s = act(s, 0, { t: 'move', iid: d, to: 'grave' });
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'pickrace')!, face: 0, pay: freeMana(s, 0, 1) });
    for (let k = 0; k < 6 && s.pending.length; k++) {
      const top = s.pending[0];
      if (top.kind === 'choice' && top.mode === 'modal') {
        const idx = (top.labels ?? []).indexOf('アーマード・ドラゴン');
        expect(idx).toBeGreaterThanOrEqual(0);
        s = act(s, 0, { t: 'choose', options: [idx] });
      } else if (top.kind === 'choice') s = act(s, 0, { t: 'choose', picks: top.options.slice(0, 1) });
      else s = act(s, 0, { t: 'resolve', use: true });
    }
    expect(s.cards[d].zone).toBe('hand');
  });

  it('封印: sealed creatures cannot attack/block; a command entering removes a seal', () => {
    let s = setup([
      { p: 0, cid: 'sealer', zone: 'hand' },
      { p: 1, cid: 'guard', zone: 'battle' },
      { p: 1, cid: 'cmd', zone: 'hand' },
    ]);
    const g = find(s, 1, 'battle', 'guard')!;
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'sealer')!, face: 0, pay: freeMana(s, 0, 2) });
    for (let k = 0; k < 6 && s.pending.length; k++) {
      const top = s.pending[0];
      s = act(s, top.player, top.kind === 'choice' ? { t: 'choose', picks: [g] } : { t: 'resolve', use: true });
    }
    expect(s.cards[g].under.some((u) => s.cards[u].sealOf === g)).toBe(true);
    s.cards[g].sick = false;
    s.active = 1;
    expect(applyAction(s, 1, { t: 'attack', attacker: g, player: 0 }, L).error).toBeTruthy();
    s = act(s, 1, { t: 'play', iid: find(s, 1, 'hand', 'cmd')!, face: 0, pay: freeMana(s, 1, 1) });
    expect(s.cards[g].under.some((u) => s.cards[u].sealOf === g)).toBe(false);
  });

  it('バズレンダ: pays extra and uses the OL ability that many more times', () => {
    let s = setup([{ p: 0, cid: 'buzz', zone: 'hand' }], 4);
    const hand = s.players[0].hand.length;
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'buzz')!, face: 0, pay: freeMana(s, 0, 4), buzz: 2 });
    for (let k = 0; k < 6 && s.pending.length; k++) s = act(s, s.pending[0].player, { t: 'resolve', use: true });
    expect(s.players[0].hand.length).toBe(hand - 1 + 3);
  });

  it('ビビッドロー: drawn during own turn can be summoned for its vivid cost', () => {
    let s = setup([{ p: 0, cid: 'vivid', zone: 'hand' }], 2);
    // 山札の一番上に置いて引く
    const v = find(s, 0, 'hand', 'vivid')!;
    s.players[0].hand = s.players[0].hand.filter((x) => x !== v);
    s.cards[v].zone = 'deck';
    s.players[0].deck.push(v);
    s = act(s, 0, { t: 'draw', n: 1 });
    expect(s.cards[v].vividTurn).toBe(s.turn);
    s = act(s, 0, { t: 'play', iid: v, face: 0, pay: freeMana(s, 0, 2), alt: 'vivid' });
    expect(s.cards[v].zone).toBe('battle');
  });

  it('逆転撃: cast when attacked, pay at next turn start or lose', () => {
    const f = L('gyaku')!.faces[0];
    expect(f.triggers.some((t) => t.fromHand && t.events.includes('oppAttack'))).toBe(true);
    expect(programOf(f.triggers[0].effect).complete).toBe(true);
  });

  it('O・ドライブ: the extra ability works only when the extra mana is tapped', () => {
    let s = setup([{ p: 0, cid: 'odr', zone: 'hand' }], 4);
    const o = find(s, 0, 'hand', 'odr')!;
    const hand = s.players[0].hand.length;
    const mana = s.players[0].mana;
    s = act(s, 0, { t: 'play', iid: o, face: 0, pay: mana.slice(0, 2), odrivePay: mana.slice(2, 4) });
    for (let k = 0; k < 4 && s.pending.length; k++) s = act(s, s.pending[0].player, { t: 'resolve', use: true });
    expect(s.players[0].hand.length).toBe(hand - 1 + 2);
    expect(kwOf(s, L, o).breaker).toBe(2);
    let t = setup([{ p: 0, cid: 'odr', zone: 'hand' }], 4);
    const o2 = find(t, 0, 'hand', 'odr')!;
    const h2 = t.players[0].hand.length;
    t = act(t, 0, { t: 'play', iid: o2, face: 0, pay: t.players[0].mana.slice(0, 2) });
    for (let k = 0; k < 4 && t.pending.length; k++) t = act(t, t.pending[0].player, { t: 'resolve', use: true });
    expect(t.players[0].hand.length).toBe(h2 - 1);
  });

  it('デッキ進化 / ダイナモ', () => {
    let s = setup([
      { p: 0, cid: 'devo', zone: 'hand' },
      { p: 0, cid: 'dyn', zone: 'battle' },
      { p: 0, cid: 'dyn', zone: 'battle' },
    ]);
    const d = find(s, 0, 'hand', 'devo')!;
    s = act(s, 0, { t: 'play', iid: d, face: 0, pay: freeMana(s, 0, 2), evo: [] });
    expect(s.cards[d].zone).toBe('battle');
    expect(s.cards[d].under.length).toBe(1);
    const [a, b] = s.players[0].battle.filter((x) => s.cards[x].cid === 'dyn');
    s = act(s, 0, { t: 'dynamo', iid: a, onto: b });
    expect(power(s, L, b)).toBe(6000);
  });

  it('城: fortifies a shield; its ability works until the shield leaves', () => {
    let s = setup([
      { p: 0, cid: 'castle', zone: 'hand' },
      { p: 0, cid: 'vanilla', zone: 'battle' },
    ]);
    const c = find(s, 0, 'hand', 'castle')!;
    const v = s.players[0].battle.find((b) => s.cards[b].cid === 'vanilla')!;
    s = act(s, 0, { t: 'play', iid: c, face: 0, pay: freeMana(s, 0, 2) });
    expect(s.cards[c].fortOf).toBeDefined();
    expect(power(s, L, v)).toBe(4000);
    const sh = s.cards[c].fortOf!;
    s = act(s, 0, { t: 'move', iid: sh, to: 'hand' });
    expect(s.cards[c].zone).toBe('grave');
    expect(power(s, L, v)).toBe(1000);
  });

  it('禁断: starts in play with seals, commands remove them, and it flips when all are gone', () => {
    let s = setup([
      { p: 0, cid: 'cmd', zone: 'hand' },
      { p: 0, cid: 'cmd', zone: 'hand' },
    ], 3);
    // setup で作り直すので、禁断の鼓動はデッキに入れて createGame から配置させる
    const g = createGame({ mode: 'duema', seed: 3, createdAt: 0, players: [0, 1].map((p) => ({ uid: 'u' + p, name: 'P' + p, cpu: false, main: [...Array(30).fill('vanilla'), ...(p === 0 ? ['kodo', 'cmd', 'cmd'] : [])], hyper: [], gr: [], partner: null })) } as never, L);
    const k = g.cards.findIndex((c) => c.cid === 'kodo');
    expect(g.cards[k].zone).toBe('battle');
    expect(g.cards[k].under.filter((u) => g.cards[u].sealOf === k).length).toBe(2);
    void s;
    s = structuredClone(g);
    s.pending = [];
    s.turnStep = 'main';
    s.active = 0;
    for (const cid of ['cmd', 'cmd']) {
      const c = s.cards.findIndex((x, i) => x.cid === cid && x.zone !== 'battle' && x.owner === 0 && i !== k && x.zone !== 'under');
      const z = s.cards[c].zone as 'deck';
      (s.players[0][z] as number[]).splice((s.players[0][z] as number[]).indexOf(c), 1);
      s.cards[c].zone = 'hand';
      s.players[0].hand.push(c);
      s = act(s, 0, { t: 'play', iid: c, face: 0, pay: [], free: true, force: true });
      for (let j = 0; j < 4 && s.pending.length; j++) s = act(s, s.pending[0].player, { t: 'resolve', use: true });
    }
    expect(s.cards[k].face).toBe(1);
  });

  it('とどまる / ブレイクしたシールドを墓地へ', () => {
    let s = setup([
      { p: 0, cid: 'stayT', zone: 'battle', tapped: true },
      { p: 0, cid: 'b2g', zone: 'battle' },
    ]);
    const st = find(s, 0, 'battle', 'stayT')!;
    s = act(s, 0, { t: 'move', iid: st, to: 'grave' });
    expect(s.cards[st].zone).toBe('battle');
    const grave = s.players[1].grave.length;
    const hand = s.players[1].hand.length;
    s = act(s, 0, { t: 'attack', attacker: find(s, 0, 'battle', 'b2g')!, player: 1 });
    for (let k = 0; k < 8 && (s.attack || s.pending.length); k++) {
      const top = s.pending[0];
      if (!top) break;
      s = act(s, top.player, top.kind === 'breakSel' ? { t: 'breakSel', shields: s.players[1].shield.slice(0, top.count) } : top.kind === 'block' ? { t: 'block', blocker: null } : top.kind === 'choice' ? { t: 'choose', yes: false, picks: [], options: [0] } : top.kind === 'attackOpt' ? { t: 'attackOpt', iid: null } : { t: 'resolve', use: true });
    }
    expect(s.players[1].grave.length).toBe(grave + 1);
    expect(s.players[1].hand.length).toBe(hand);
  });

  it('ガチャ: rolls and uses the rolled abilities, recording them for the roulette', () => {
    let s = setup([{ p: 0, cid: 'gachaSp', zone: 'hand' }]);
    s = act(s, 0, { t: 'play', iid: find(s, 0, 'hand', 'gachaSp')!, face: 0, pay: freeMana(s, 0, 1) });
    expect(s.gachaLog?.length).toBe(2);
    expect(s.gachaLog!.every((g) => g.kind === 'dogiragon' && g.roll >= 0 && g.roll < 6)).toBe(true);
    // 出た目の能力が順に解決される
    for (let k = 0; k < 12 && s.pending.length; k++) {
      const top = s.pending[0];
      s = act(s, top.player, top.kind === 'choice' ? (top.mode === 'yesno' ? { t: 'choose', yes: true, picks: [], options: [0] } : { t: 'choose', picks: top.options.slice(0, top.min), options: [0] }) : { t: 'resolve', use: true });
    }
    expect(s.log.filter((l) => l.m.startsWith('ドギラゴン・ガチャ:')).length).toBe(2);
  });

  it('手札を捨てて召喚コストを少なくする', () => {
    let s = setup([
      { p: 0, cid: 'ddisc', zone: 'hand' },
      { p: 0, cid: 'vanilla', zone: 'hand' },
    ]);
    const d = find(s, 0, 'hand', 'ddisc')!;
    const v = s.players[0].hand.find((h) => s.cards[h].cid === 'vanilla')!;
    s = act(s, 0, { t: 'play', iid: d, face: 0, pay: freeMana(s, 0, 3), discards: [v] });
    expect(s.cards[d].zone).toBe('battle');
    expect(s.cards[v].zone).toBe('grave');
  });

  it('鬼タイム: 真上の能力はシールドの合計が少ない時だけ無視される', () => {
    const s = setup([{ p: 0, cid: 'oni', zone: 'battle' }]);
    const o = find(s, 0, 'battle', 'oni')!;
    expect(kwOf(s, L, o).cantAttack).toBe(true);
    for (const pl of s.players) while (pl.shield.length > 3) pl.shield.pop();
    expect(kwOf(s, L, o).cantAttack).toBeFalsy();
  });
});
