"""Downloads every reward icon (large version) once into assets/missions/ and writes rewards_icons.json {item: file}."""
import json, os, re, sys, time, urllib.request

themed = sys.argv[1]
dest = r'C:\Users\Ale TCG\Documents\Monitor Pokemon\assets\missions'
os.makedirs(dest, exist_ok=True)
d = json.load(open(themed, encoding='utf-8'))
items = {}
for e in d:
    for c in e['collections']:
        for r in c['rewards']:
            items[r['item']] = r['icon']
mapa, fallos = {}, []
for item, icon in sorted(items.items()):
    grande = icon.replace('/th/', '/')
    ext = os.path.splitext(grande)[1].lower() or '.png'
    nombre = re.sub(r'[^a-z0-9]+', '_', item.lower()).strip('_') + ext
    ruta = os.path.join(dest, nombre)
    if not os.path.exists(ruta):
        ok = False
        for url in ('https://www.serebii.net' + grande, 'https://www.serebii.net' + icon):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                data = urllib.request.urlopen(req, timeout=30).read()
                if len(data) > 500:
                    open(ruta, 'wb').write(data)
                    ok = True
                    break
            except Exception:
                pass
        time.sleep(0.3)
        if not ok:
            fallos.append(item)
            continue
    mapa[item] = nombre
json.dump(mapa, open(os.path.join(dest, 'rewards_icons.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(mapa), 'icons ok;', len(fallos), 'failed:', fallos)
