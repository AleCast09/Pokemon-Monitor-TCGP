"""Serebii set pages -> assets/packs/card_packs.json:
{ "A1": { "packs": ["Mewtwo","Charizard","Pikachu"], "byNum": {"1": ["Mewtwo"], ...}, "byName": {"bulbasaur": ["Mewtwo"], ...} }, ... }
Only expansions with 2+ packs."""
import json, os, re

scratch = os.path.dirname(os.path.abspath(__file__))
dest = r'C:\Users\Ale TCG\Documents\Monitor Pokemon\assets\packs'
sets = {'A1': 'geneticapex', 'A2': 'space-timesmackdown', 'A3': 'celestialguardians', 'A4': 'wisdomofseaandsky',
        'B1': 'megarising', 'C1': 'dualfusion'}
logos = json.load(open(os.path.join(dest, 'logos.json'), encoding='utf-8'))
norm = lambda t: re.sub(r'[^a-z0-9]', '', t.lower())
out = {}
for code, slug in sets.items():
    s = re.sub(r'\s+', ' ', open(os.path.join(scratch, 'sets', slug + '.html'), encoding='latin-1').read())
    filas = []
    for fila in re.split(r'<tr> <td class="cen"><a href="/tcgpocket/[^/"]+/">', s)[1:]:
        mn = re.search(r'/tcgpocket/[^/"]+/(\d+)\.shtml', fila)
        mnom = re.search(r'<td class="cen" width="20%">(.*?)</td>', fila)
        if not mn or not mnom or 'Booster Pack' not in fila:
            continue
        nombre = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', mnom.group(1))).strip()
        filas.append((mn.group(1), nombre, fila))
    byNum, byName = {}, {}
    for num, nombre, packs in filas:
        lista = list(dict.fromkeys(re.findall(r'title="([^"]+?) Booster Pack"', packs)))
        if not lista:
            continue
        byNum[str(int(num))] = lista
        k = norm(nombre)
        byName[k] = sorted(set(byName.get(k, [])) | set(lista)) if k in byName else lista
    orden = list(logos[code].keys())
    out[code] = {'packs': orden, 'logos': logos[code], 'byNum': byNum, 'byName': byName}
    sueltos = {p for v in byNum.values() for p in v} - set(orden)
    print(code, len(byNum), 'cards; packs', orden, '| not in logos:', sueltos or '-')
json.dump(out, open(os.path.join(dest, 'card_packs.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
