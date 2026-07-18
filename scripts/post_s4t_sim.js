const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

(async ()=>{
    try {
        const url = 'http://localhost:3000/';
        const xmlPath = 'C:/POKEMON/PTCGPB-ALE/Accounts/Saved/2/138P_20260118105216_3(XR).xml';
        const imgPath = 'C:/POKEMON/PTCGPB-ALE/Helper/CardImageCache/cPK_20_019220_01_DEDENNEex_IM.png';
        if (!fs.existsSync(xmlPath)) return console.error('XML not found', xmlPath);
        if (!fs.existsSync(imgPath)) return console.error('Image not found', imgPath);

        const contentLines = [];
        contentLines.push('Instance: 2 (some·data)');
        contentLines.push('File name: 138P_20260118105216_3(XR).xml');
        contentLines.push('\n');
        contentLines.push('immersive');
        contentLines.push('PK_20_019220_01');

        const payload = { content: contentLines.join('\n') };

        const form = new FormData();
        form.append('payload_json', JSON.stringify(payload));
        form.append('files[0]', fs.createReadStream(xmlPath), { filename: path.basename(xmlPath) });
        form.append('files[1]', fs.createReadStream(imgPath), { filename: path.basename(imgPath) });

        const headers = form.getHeaders();
        const resp = await axios.post(url, form, { headers, maxBodyLength: Infinity });
        console.log('POST status', resp.status);
    } catch (e) { console.error(e.response?.status, e.message); }
})();