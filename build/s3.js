(function() {
  'use strict';
  var AWS, settings, stream;

  settings = require('./settings');

  AWS = require('aws-sdk');

  stream = require('stream');

  module.exports = function() {
    var S3, s3Stream;
    AWS.config.bucket = settings.AWS_BUCKET;
    AWS.config.region = settings.AWS_REGION;
    AWS.config.accessKeyId = settings.AWS_ID;
    AWS.config.secretAccessKey = settings.AWS_KEY;
    S3 = new AWS.S3();
    s3Stream = require('s3-upload-stream')(S3);
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
          var d;
          if (e || !r.Body) {
            return typeof cb === "function" ? cb(e || 'error', null) : void 0;
          }
          d = null;
          try {
            d = JSON.parse(r.Body);
          } catch (error) {
            e = error;
            return typeof cb === "function" ? cb(e || 'error', null) : void 0;
          }
          return typeof cb === "function" ? cb(null, d) : void 0;
        });
      },
      getReadStream: function(key) {
        var m;
        m = {
          Bucket: AWS.config.bucket,
          Key: key
        };
        return S3.getObject(m).createReadStream();
      },
      getWriteStream: function(key) {
        var upload;
        upload = s3Stream.upload({
          Bucket: AWS.config.bucket,
          Key: key
        });
        return upload;
      }
    };
  };

}).call(this);

//# sourceMappingURL=s3.js.map
