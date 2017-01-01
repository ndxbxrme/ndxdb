(function() {
  'use strict';
  var AWS;

  AWS = require('aws-sdk');

  module.exports = function(config) {
    var S3, dbname;
    dbname = config.database || config.dbname || config.databaseName;
    AWS.config.bucket = config.awsBucket;
    AWS.config.region = config.awsRegion;
    AWS.config.accessKeyId = config.awsId;
    AWS.config.secretAccessKey = config.awsKey;
    S3 = new AWS.S3();
    return {
      dbs: function(cb) {
        return S3.listBuckets({}, function(e, r) {
          return typeof cb === "function" ? cb(e, r) : void 0;
        });
      },
      keys: function(from, prefix, cb) {
        var m;
        m = {
          Bucket: AWS.config.bucket,
          Prefix: prefix
        };
        if (from) {
          m.Marker = from;
        }
        return S3.listObjects(m, function(e, r) {
          return typeof cb === "function" ? cb(e, r) : void 0;
        });
      },
      del: function(key, cb) {
        var m;
        m = {
          Bucket: AWS.config.bucket,
          Key: key
        };
        return S3.deleteObject(m, function(e, r) {
          return typeof cb === "function" ? cb(e, r) : void 0;
        });
      },
      put: function(key, o, cb) {
        var m;
        m = {
          Bucket: AWS.config.bucket,
          Key: key,
          Body: JSON.stringify(o),
          ContentType: 'application/json'
        };
        return S3.putObject(m, function(e, r) {
          if (e) {
            console.log('put error', key);
          } else {
            console.log('put success', key);
          }
          return typeof cb === "function" ? cb(e, r) : void 0;
        });
      },
      get: function(key, cb) {
        var m;
        m = {
          Bucket: AWS.config.bucket,
          Key: key
        };
        return S3.getObject(m, function(e, r) {
          var d, error;
          if (e || !r.Body) {
            return typeof cb === "function" ? cb(e || 'error', null) : void 0;
          }
          d = null;
          console.log('got', key);
          try {
            d = JSON.parse(r.Body);
          } catch (error) {
            e = error;
            return typeof cb === "function" ? cb(e || 'error', null) : void 0;
          }
          return typeof cb === "function" ? cb(null, d) : void 0;
        });
      }
    };
  };

}).call(this);

//# sourceMappingURL=s3.js.map
