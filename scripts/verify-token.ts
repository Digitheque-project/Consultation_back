import * as jwt from 'jsonwebtoken';

// Le token que tu as
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjE2LCJtZWRlY2luSWQiOjE2LCJlbWFpbCI6Im1lZGVjaW4xQGNodS5tZyIsImlhdCI6MTc4MjE1NDE4MiwiZXhwIjoxNzgyMjQwNTgyfQ.CYGMv-UOgpy_FohjtEivE7hQqO16lwg7rmzDgyEnpws';

// Décoder sans vérifier la signature d'abord
const decoded = jwt.decode(token, { complete: true });
console.log('=== TOKEN DÉCODÉ ===');
console.log(JSON.stringify(decoded, null, 2));

// Essayer de vérifier avec la clé par défaut
const secret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
try {
  const verified = jwt.verify(token, secret);
  console.log('\n=== TOKEN VÉRIFIÉ ✅ ===');
  console.log(JSON.stringify(verified, null, 2));
} catch (err) {
  console.log('\n=== ERREUR DE VÉRIFICATION ❌ ===');
  console.log('Erreur:', err.message);
  console.log('Secret utilisé:', secret);
}
