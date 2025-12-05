// api/index.js
// Vercel sẽ dùng file này làm serverless function tại đường dẫn /api
const app = require("../app");

// Export app của bạn cho Vercel
module.exports = app;