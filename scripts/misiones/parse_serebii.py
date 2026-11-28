"""Serebii themed collections -> JSON: [{expansion, collections:[{name, groups:[{any:N|None, cards:[{set, num, name}]}], rewards:[{item, icon, qty}]}]}]"""
import re, json, sys, html

src = sys.argv[1]
out = sys.argv[2]
s = re.sub(r'\s+', ' ', open(src, encoding='latin-1').read())
inicio = s.find('List of Themed Collections')
heads = [(m.start(), html.unescape(m.group(1)).strip()) for m in re.finditer(r'<h2[^>]*>(.*?)</h2>', s) if m.start() > inicio]
res = []
for i, (pos, nombre) in enumerate(heads):
    if nombre == 'List of Themed Collections':
        continue
    fin = heads[i + 1][0] if i + 1 < len(heads) else len(s)
    seg = s[pos:fin]
    cols = []
    for fila in re.finditer(r'<td class="cen">(.*?)</td> <td class="fooinfo">(.*?)</td> <td class="fooinfo"[^>]*>(.*?</table>)', seg):
        titulo = html.unescape(re.sub(r'<[^>]+>', '', fila.group(1))).strip()
        req = fila.group(2)
        grupos, actual = [], None
        # Old sets: plain lines "Any Bulbasaur" (any version of that card)
        for linea in re.split(r'<br ?/?>', req):
            txt = html.unescape(re.sub(r'<[^>]+>', '', linea)).strip(' :')
            if '<a ' not in linea and txt.lower().startswith('any ') and not txt.lower().startswith('any of the following'):
                resto = txt[4:].strip()
                if re.match(r'^\d+\s', resto):   # "Any 15 Pokemon ex Cards": a rule, not a card
                    grupos.append({'any': None, 'text': resto, 'cards': []})
                else:
                    resto = re.sub(r'\s+cards?$', '', resto, flags=re.I)
                    nombres = [n.strip() for n in re.split(r'\s+or\s+', resto) if n.strip()]
                    grupos.append({'any': 1 if len(nombres) > 1 else None,
                                   'cards': [{'set': None, 'num': None, 'name': n, 'anyVersion': True} for n in nombres]})
        for tok in re.finditer(r'''<b>Any of the Following (\d+) Cards?</b>|<a href="/tcgpocket/([a-z0-9'\-]+)/(\d+)\.shtml"><u>(.*?)</u>''', req):
            if tok.group(1):
                actual = {'any': int(tok.group(1)), 'cards': []}
                grupos.append(actual)
            else:
                if actual is None or (actual['any'] and len(actual['cards']) >= actual['any']):
                    actual = {'any': None, 'cards': []}
                    grupos.append(actual)
                txt = html.unescape(tok.group(4)).strip()
                txt = re.sub(r'^\d+\s*', '', txt).strip(' -')
                txt = re.sub(r"^(Mega|Paldean|Alolan|Galarian|Hisuian|Team Rocket's)\s*-\s*", r'\1 ', txt)
                actual['cards'].append({'set': tok.group(2), 'num': int(tok.group(3)), 'name': txt})
        premios = []
        for p in re.finditer(r'<img src="([^"]+)" alt="([^"]*)"[^>]*/> ?</td> ?<td>(.*?)</td>', fila.group(3)):
            m = re.match(r'(.*?)\s*\*\s*(\d*)\s*$', html.unescape(re.sub(r'<[^>]+>', '', p.group(3))))
            premios.append({'item': (m.group(1) if m else p.group(2)).strip(), 'icon': p.group(1),
                            'qty': int(m.group(2)) if m and m.group(2) else None})
        cols.append({'name': titulo, 'groups': grupos, 'rewards': premios})
    if cols:
        res.append({'expansion': nombre, 'collections': cols})
json.dump(res, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(res), 'expansions', sum(len(e['collections']) for e in res), 'collections')
items = {}
for e in res:
    for c in e['collections']:
        for p in c['rewards']:
            items[p['item']] = p['icon']
print(len(items), 'reward kinds')
for k, v in sorted(items.items())[:80]:
    print(' ', k, '|', v)
sets = sorted({c['set'] for e in res for col in e['collections'] for g in col['groups'] for c in g['cards']})
print('sets', sets)
