const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const CLIENT_ID = '0XdrYmgyb3Ftd2pRYkwyY3RzN2E6MTpja0';
const CLIENT_SECRET = 't7UkhFWdQlli_Ul9MXVjis_uqA-D0aIpoTkIy3Q-ocQqMuC1X8';
const REDIRECT_URI = 'https://followcheckapp-production.up.railway.app/callback';

const sessions = {};

app.get('/auth', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  sessions[state] = { codeVerifier };
  const url = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=tweet.read%20users.read%20follows.read&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
  res.redirect(url);
});

app.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  const session = sessions[state];
  if (!session) return res.status(400).send('Geçersiz oturum');

  const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: session.codeVerifier
    })
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return res.status(400).send('Token alınamadı');

  delete sessions[state];
  res.redirect(`/?token=${tokenData.access_token}`);
});

async function fetchAllPages(token, endpoint, params) {
  let results = [];
  let nextToken = null;
  let pages = 0;
  do {
    const urlParams = new URLSearchParams(params);
    if (nextToken) urlParams.set('pagination_token', nextToken);
    const url = `https://api.twitter.com/2/${endpoint}?${urlParams}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || err.title || `API hatası: ${res.status}`);
    }
    const json = await res.json();
    if (json.data) results = results.concat(json.data);
    nextToken = json.meta?.next_token;
    pages++;
    if (pages > 15) break;
  } while (nextToken);
  return results;
}

app.post('/analyze', async (req, res) => {
  const { token, username } = req.body;
  try {
    const userRes = await fetch(
      `https://api.twitter.com/2/users/by/username/${username}?user.fields=public_metrics`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!userRes.ok) throw new Error('Kullanıcı bulunamadı.');
    const userJson = await userRes.json();
    const userId = userJson.data.id;

    const [following, followers] = await Promise.all([
      fetchAllPages(token, `users/${userId}/following`, { max_results: 1000, 'user.fields': 'profile_image_url,name,username' }),
      fetchAllPages(token, `users/${userId}/followers`, { max_results: 1000, 'user.fields': 'profile_image_url,name,username' })
    ]);

    const followerIds = new Set(followers.map(u => u.id));
    const followingIds = new Set(following.map(u => u.id));

    res.json({
      following: following.length,
      followers: followers.length,
      notFollowingBack: following.filter(u => !followerIds.has(u.id)),
      notFollowedBack: followers.filter(u => !followingIds.has(u.id)),
      mutual: following.filter(u => followerIds.has(u.id))
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.listen(3000, () => console.log('Sunucu çalışıyor: http://localhost:3000'));