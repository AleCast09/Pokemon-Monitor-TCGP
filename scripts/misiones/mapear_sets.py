"""Serebii set slug -> our ExpansionID, matching card names at (expansion, number). Adds 'id' to each card."""
import json, re, sys, collections

helper = r'C:\POKEMON\PTCGPB-ALE\Helper'
themed = sys.argv[1]
cm = json.load(open(helper + r'\cardmap.json', encoding='utf-8'))
master = json.load(open(helper + r'\cardmaster.json', encoding='utf-8'))
en = json.load(open(helper + r'\en_US.json', encoding='utf-8'))

def nombre(cid):
    info = master.get(cid) or {}
    return en.get(info.get('Name'), '') if isinstance(info, dict) else ''

def norm(t):
    return re.sub(r'[^a-z0-9]', '', str(t).lower().replace('é', 'e'))

por_pos = collections.defaultdict(list)   # (exp, num) -> [ids]
for cid, v in cm.items():
    por_pos[(v.get('ExpansionID'), v.get('CollectionNumber'))].append(cid)

d = json.load(open(themed, encoding='utf-8'))
votos = collections.defaultdict(collections.Counter)
for e in d:
    for col in e['collections']:
        for g in col['groups']:
            for c in g['cards']:
                for (exp, num), ids in por_pos.items():
                    if c['num'] is not None and num == c['num'] and any(norm(nombre(i)) and norm(c['name']).endswith(norm(nombre(i))[-6:]) for i in ids):
                        votos[c['set']][exp] += 1
mapa = {slug: cnt.most_common(1)[0][0] for slug, cnt in votos.items()}
print(json.dumps({k: (v, votos[k].most_common(3)) for k, v in mapa.items()}, indent=0))

sin = 0
for e in d:
    for col in e['collections']:
        for g in col['groups']:
            for c in g['cards']:
                exp = mapa.get(c['set'])
                ids = por_pos.get((exp, c['num']), [])
                c['id'] = sorted(ids)[0] if ids else None
                c['exp'] = exp
                if not ids:
                    sin += 1
json.dump(d, open(themed.replace('.json', '_ids.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('cards without id:', sin)

# Reprints: cardmap keeps one entry per id (the later expansion), so some (exp, num) are missing.
# Fallback by name: same name, normal art (_00), not a promo; the earliest one.
por_nombre = collections.defaultdict(list)
for cid, v in cm.items():
    por_nombre[norm(nombre(cid))].append(cid)
sin2 = 0
for e in d:
    for col in e['collections']:
        for g in col['groups']:
            for c in g['cards']:
                if c['id']:
                    continue
                cands = [i for i in por_nombre.get(norm(c['name']), []) if not cm[i]['ExpansionID'].startswith('PROMO')]
                if not cands:   # "Kingdra" -> "Kingdra ex", "Clodsire" -> "Paldean Clodsire"
                    k = norm(c['name'])
                    cands = [i for n, ids in por_nombre.items() if n and (n.startswith(k) or n.endswith(k)) for i in ids
                             if not cm[i]['ExpansionID'].startswith('PROMO')]
                cands.sort(key=lambda i: (not i.endswith('_00'), i))
                c['id'] = cands[0] if cands else None
                if not c['id']:
                    sin2 += 1
                    print('  sin id:', c)
json.dump(d, open(themed.replace('.json', '_ids.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('cards without id after name match:', sin2)
