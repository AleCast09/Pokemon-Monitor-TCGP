const sharp = require('sharp');
const path = require('path');

async function main() {
    const origen = path.join(__dirname, '..', 'assets', 'expansions', 'Genetic Apex', 'packshots', 'A1_Booster_Charizard_EN.png');
    const destino = path.join(__dirname, '..', 'assets', 'expansions', 'test', 'Genetic_Apex_680x1370.png');

    await sharp(origen)
        .resize(680, 1370, { fit: 'cover' })
        .toFile(destino);

    const meta = await sharp(destino).metadata();
    console.log('✅ Creado:', destino, '->', meta.width, 'x', meta.height);
}
main().catch(err => console.error('❌', err.message));
