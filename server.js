const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

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