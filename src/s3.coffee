'use strict'

settings = './settings'
AWS = require 'aws-sdk'

module.exports = ->
  AWS.config.bucket = settings.AWS_BUCKET
  AWS.config.region = settings.AWS_REGION
  AWS.config.accessKeyId = settings.AWS_ID
  AWS.config.secretAccessKey = settings.AWS_KEY
  S3 = new AWS.S3()
  
  dbs: (cb) ->
    S3.listBuckets {}, (e, r) ->
      cb? e, r
  keys: (from, prefix, cb) ->
    m =
      Bucket: AWS.config.bucket
      Prefix: prefix
    if from
      m.Marker = from
    S3.listObjects m, (e, r) ->
      cb? e, r
  del: (key, cb) ->
    m =
      Bucket: AWS.config.bucket
      Key: key
    S3.deleteObject m, (e, r) ->
      cb? e, r
  put: (key, o, cb) ->
    m =
      Bucket: AWS.config.bucket
      Key: key
      Body: JSON.stringify o
      ContentType: 'application/json'
    S3.putObject m, (e, r) ->
      cb? e, r
  get: (key, cb) ->
    m =
      Bucket: AWS.config.bucket
      Key: key
    S3.getObject m, (e, r) ->
      if e or not r.Body
        return cb?(e or 'error', null)
      d = null
      try
        d = JSON.parse r.Body
      catch e
        return cb?(e or 'error', null)
      cb? null, d