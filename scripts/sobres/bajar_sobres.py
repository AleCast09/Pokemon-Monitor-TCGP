"""Downloads the 14 booster pack logos from WikiDex (MediaWiki API) into assets/packs/."""
import json, os, time, urllib.parse, urllib.request

dest = r'C:\Users\Ale TCG\Documents\Monitor Pokemon\assets\packs'
os.makedirs(dest, exist_ok=True)
# our expansion code + pack name (as in pack_catalog) -> WikiDex file
logos = {
    ('A1', 'Mewtwo'): 'Icono Genes Formidables sobre Mewtwo.png',
    ('A1', 'Charizard'): 'Icono Genes Formidables sobre Charizard.png',
    ('A1', 'Pikachu'): 'Icono Genes Formidables sobre Pikachu.png',
    ('A2', 'Dialga'): 'Icono Pugna Espaciotemporal sobre Dialga.png',
    ('A2', 'Palkia'): 'Icono Pugna Espaciotemporal sobre Palkia.png',
    ('A3', 'Solgaleo'): 'Icono Guardianes Celestiales sobre Solgaleo.png',
    ('A3', 'Lunala'): 'Icono Guardianes Celestiales sobre Lunala.png',
    ('A4', 'Ho-Oh'): 'Icono Saber Marino y Celeste sobre Ho-Oh.png',
    ('A4', 'Lugia'): 'Icono Saber Marino y Celeste sobre Lugia.png',
    ('B1', 'Mega Blaziken'): 'Icono Megaascenso sobre Mega-Blaziken.png',
    ('B1', 'Mega Gyarados'): 'Icono Megaascenso sobre Mega-Gyarados.png',
    ('B1', 'Mega Altaria'): 'Icono Megaascenso sobre Mega-Altaria.png',
    ('C1', 'Mega Mewtwo X'): 'Icono Fusión Dual sobre Mega-Mewtwo X.png',
    ('C1', 'Pikachu'): 'Icono Fusión Dual sobre Pikachu.png',
}
api = 'https://www.wikidex.net/api.php?action=query&prop=imageinfo&iiprop=url&format=json&titles='
hecho = {}
for (exp, pack), archivo in logos.items():
    nombre = f"{exp}_{pack.lower().replace(' ', '_').replace('-', '')}.png"
    ruta = os.path.join(dest, nombre)
    if not os.path.exists(ruta):
        q = urllib.request.Request(api + urllib.parse.quote('Archivo:' + archivo), headers={'User-Agent': 'Mozilla/5.0'})
        info = json.loads(urllib.request.urlopen(q, timeout=30).read())
        pagina = next(iter(info['query']['pages'].values()))
        url = pagina.get('imageinfo', [{}])[0].get('url')
        if not url:
            print('NO URL', archivo)
            continue
        data = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30).read()
        open(ruta, 'wb').write(data)
        time.sleep(0.4)
    hecho.setdefault(exp, {})[pack] = nombre
json.dump(hecho, open(os.path.join(dest, 'logos.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(sum(len(v) for v in hecho.values()), 'logos')
