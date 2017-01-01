'use strict'

AWS = require 'aws-sdk'

module.exports = (config) ->
  dbname = config.database or config.dbname or config.databaseName
  AWS.config.bucket = config.awsBucket
  AWS.config.region = config.awsRegion
  AWS.config.accessKeyId = config.awsId
  AWS.config.secretAccessKey = config.awsKey
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
      if e
        console.log 'put error', key
      else
        console.log 'put success', key
      cb? e, r
  get: (key, cb) ->
    m =
      Bucket: AWS.config.bucket
      Key: key
    S3.getObject m, (e, r) ->
      if e or not r.Body
        return cb?(e or 'error', null)
      d = null
      console.log 'got', key
      try
        d = JSON.parse r.Body
      catch e
        return cb?(e or 'error', null)
      cb? null, d