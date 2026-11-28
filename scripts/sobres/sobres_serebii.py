"""For every expansion page on Serebii: which booster packs exist and how many cards each one has."""
import re, json, os, time, urllib.request, collections

slugs = ['geneticapex', 'mythicalisland', 'space-timesmackdown', 'triumphantlight', 'shiningrevelry', 'celestialguardians',
         'extradimensionalcrisis', 'eeveegrove', 'wisdomofseaandsky', 'secludedsprings', 'deluxepackex', 'megarising',
         'crimsonblaze', 'fantasticalparade', 'paldeanwonders', 'megashine', 'pulsingaura', 'paradoxdrive',
         'everydaywonders', 'ruleroftheskies', "teamrocket'sambition", 'deluxepackmega', 'dualfusion']
dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sets')
os.makedirs(dest, exist_ok=True)
resumen = {}
for slug in slugs:
    ruta = os.path.join(dest, slug.replace("'", '') + '.html')
    if not os.path.exists(ruta):
        try:
            data = urllib.request.urlopen(urllib.request.Request(f'https://www.serebii.net/tcgpocket/{slug}/',
                                                                 headers={'User-Agent': 'Mozilla/5.0'}), timeout=40).read()
            open(ruta, 'wb').write(data)
        except Exception as e:
            print(slug, 'ERROR', e)
            continue
        time.sleep(0.4)
    s = re.sub(r'\s+', ' ', open(ruta, encoding='latin-1').read())
    filas = re.findall(r'<a href="/tcgpocket/[^/]+/(\d+)\.shtml"> <font size="2">(.*?)</font>.*?<td class="cen">(.*?)</td></tr>', s)
    c = collections.Counter()
    for num, nom, packs in filas:
        for t in re.findall(r'title="([^"]+)"', packs) or ['(none)']:
            c[t] += 1
    resumen[slug] = {'cards': len(filas), 'packs': dict(c)}
    print(f"{slug:24} {len(filas):4} cards  " + ' | '.join(f'{k} {v}' for k, v in c.items()))
json.dump(resumen, open(os.path.join(dest, 'resumen.json'), 'w', encoding='utf-8'), indent=1)
