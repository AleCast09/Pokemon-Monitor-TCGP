const axios = require('axios');
const FormData = require('form-data');

(async () => {
  const form = new FormData();
  const payload = { content: `Instance: 2\nFile name: account_42.xml\n★ shiny\nPikachu EX\n◆◆◆\nCharizard VSTAR\n★\nBlastoise\n◆◆◆◆\nMewtwo VMAX\n` };
  form.append('payload_json', JSON.stringify(payload));
  try {
    const res = await axios.post('http://localhost:3000/', form, { headers: form.getHeaders(), timeout: 10000 });
    console.log('POST response status:', res.status);
  } catch (e) {
    console.error('Error posting test payload:', e.message);
    if (e.response) console.error('Response status:', e.response.status, e.response.data);
  }
})();
