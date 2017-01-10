(function() {
  'use strict';
  module.exports = {
    LOCAL_STORAGE: process.env.LOCAL_STORAGE,
    PREFER_LOCAL: process.env.PREFER_LOCAL,
    DATABASE: process.env.DATABASE || 'ndxdb',
    TABLES: [],
    AWS_BUCKET: process.env.AWS_BUCKET,
    AWS_REGION: process.env.AWS_REGION || 'us-east-1',
    AWS_ID: process.env.AWS_ID,
    AWS_KEY: process.env.AWS_KEY,
    ENV: process.env.ENV || 'PRODUCTION'
  };

}).call(this);

//# sourceMappingURL=settings.js.map
