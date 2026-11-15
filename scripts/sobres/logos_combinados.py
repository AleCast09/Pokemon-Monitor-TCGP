"""Logo de expansion + logo del sobre debajo (como el del juego: "DUAL FUSION" + "Mega Mewtwo X").
-> assets/packs/combined/<codigo>_<sobre>.png y assets/packs/combined.json {"Expansion · Sobre": "archivo"}.
Correr de nuevo si cambian los logos (assets/expansions o assets/packs/logos.json)."""
import json, os
from PIL import Image

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PACKS = os.path.join(RAIZ, 'assets', 'packs')
EXP = os.path.join(RAIZ, 'assets', 'expansions')
OUT = os.path.join(PACKS, 'combined')
NOMBRES = {'A1': 'Genetic Apex', 'A2': 'Space-Time Smackdown', 'A3': 'Celestial Guardians',
           'A4': 'Wisdom of Sea and Sky', 'B1': 'Mega Rising', 'C1': 'Dual Fusion'}
os.makedirs(OUT, exist_ok=True)
logos = json.load(open(os.path.join(PACKS, 'logos.json'), encoding='utf-8'))
mapa = {}


def recortar(im):
    caja = im.getbbox()
    return im.crop(caja) if caja else im


for code, sobres in logos.items():
    nombre = NOMBRES[code]
    base = os.path.join(EXP, nombre, nombre)
    exp = recortar(Image.open(base + '.png' if os.path.exists(base + '.png') else base + '.webp').convert('RGBA'))
    for sobre, archivo in sobres.items():
        oficial = os.path.join(EXP, nombre, f'{nombre} - {sobre}.png')   # logo oficial ya combinado (si lo hay)
        if False and os.path.exists(oficial):   # (Ale 2026-11-15) todos armados igual, con espacio
            nom = os.path.splitext(archivo)[0] + '.png'
            recortar(Image.open(oficial).convert('RGBA')).save(os.path.join(OUT, nom))
            mapa[f'{nombre} · {sobre}'] = nom
            continue
        pk = recortar(Image.open(os.path.join(PACKS, archivo)).convert('RGBA'))
        ancho_pk = int(exp.width * 0.58)
        pk = pk.resize((ancho_pk, round(pk.height * ancho_pk / pk.width)), Image.LANCZOS)
        solape = -int(exp.height * 0.10)   # (Ale 2026-11-15: "que no se choquen") espacio entre logo y sobre
        W, H = exp.width, exp.height + pk.height - solape
        lienzo = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        lienzo.alpha_composite(exp, (0, 0))
        lienzo.alpha_composite(pk, ((W - pk.width) // 2, exp.height - solape))
        nom = os.path.splitext(archivo)[0] + '.png'
        lienzo.save(os.path.join(OUT, nom))
        mapa[f'{nombre} · {sobre}'] = nom
json.dump(mapa, open(os.path.join(PACKS, 'combined.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('ok', len(mapa))
