'use strict'

settings = require './settings'
async = require 'async'
crypto = require 'crypto'
jsonStream = require 'JSONStream'
es = require 'event-stream'
zlib = require 'zlib'


module.exports = ->
  algorithm = settings.ENCRYPTION_ALGORITHM or 'aes-256-ctr'
  doencrypt = !settings.DO_NOT_ENCRYPT
  dozip = !settings.DO_NOT_ENCRYPT
  s3 = require('./s3')()
  local = require('./local')()
  devices = []
  if settings.LOCAL_STORAGE
    devices.push local
  if settings.AWS_OK
    devices.push s3
  checkDataDir: ->
    if settings.LOCAL_STORAGE
      local.checkDataDir()
  keys: (from, prefix, cb) ->
    if not devices.length
      cb? 'no storage', null
    else
      calledBack = false
      async.each devices, (device, callback) ->
        device.keys from, prefix, (e, r) ->
          if not e or calledBack
            calledBack = true
            cb? e, r
          callback()
      , ->
        if not calledBack
          cb? 'nothing found', null
  del: (key, cb) ->
    async.each devices, (device, callback) ->
      device.del key, ->
        callback()
    , ->
      cb?()
  put: (key, o, cb, notCritical, writeStream) ->
    if not devices.length or notCritical
      cb? null, null
    else
      if key.indexOf(':node:') isnt -1
        key = "#{key}:#{new Date().valueOf()}"
      jsStringify = new jsonStream.stringify()
      encrypt = crypto.createCipher algorithm, settings.ENCRYPTION_KEY or settings.SESSION_SECRET or '5random7493nonsens!e'
      gzip = zlib.createGzip()
      st = null
      ws = null
      if dozip
        st = jsStringify.pipe gzip
      if doencrypt
        if st
          st = st.pipe encrypt
        else
          st = jsStringify.pipe encrypt
      if not st
        st = jsStringify
      if writeStream
        st = st.pipe writeStream
      else
        for device in devices
          writeStream = device.getWriteStream(key)
          st = st.pipe writeStream
      jsStringify.write o, ->
        jsStringify.flush()
      jsStringify.end()
      st.on 'close', ->
        cb? null, null
      st.on 'error', (er) ->
      writeStream.on 'error', (er) ->
      writeStream.on 'uploaded', (res) ->
        cb? null, null
      gzip.on 'error', (er) ->
      encrypt.on 'error', (er) ->
      #jsStringify.end()
  get: (key, cb, reader) ->
    if not devices
      cb? 'no devices', null
      done?()
    else
      jsParse = new jsonStream.parse '*'
      decrypt = crypto.createDecipher algorithm, settings.ENCRYPTION_KEY or settings.SESSION_SECRET or '5random7493nonsens!e'
      gunzip = zlib.createGunzip()
      finished = false
      async.eachSeries devices, (device, callback) ->
        if not finished
          calledBack = false
          if not reader
            reader = device.getReadStream key
          st = reader
          if doencrypt
            st = st.pipe decrypt
          if dozip
            st = st.pipe gunzip
          st.pipe jsParse
          .pipe es.mapSync (data) ->
            finished = true
            calledBack = true
            cb? null, data
            done?()
            callback()
          reader.on 'error', (e) ->
            if not calledBack
              calledBack = true
              callback()
          st.on 'error', (e) ->
            if not calledBack
              calledBack = true
              finished = true
              cb? 'encrypt error', null
              callback()
          jsParse.on 'error', (e) ->
            console.log 'Error parsing database - have you changed your encryption key or turned encryption on or off?  If so, update your database using ndx-framework.'
          st.on 'end', ->
            if not calledBack
              calledBack = true
              callback()
        else
          callback()
      , ->
        if not finished
          cb? 'nothing found', null
          done?()
  putOld: (key, o, cb, notCritical) ->
    if settings.LOCAL_STORAGE
      if not notCritical
        local.put key, o, (e, r) ->
          if settings.AWS_OK
            s3.put key, o, cb
          else
            cb? e, r
    else if settings.AWS_OK and (not notCritical)
      s3.put key, o, cb
    else
      cb? null, null
  getOld: (key, cb) ->
    if not settings.PREFER_LOCAL
      if settings.LOCAL_STORAGE
        local.get key, (e, r) ->
          if e and settings.AWS_OK
            s3.get key, cb
          else
            cb e, r
      else if settings.AWS_OK
        s3.get key, cb
      else 
        cb 'no storage', null
    else
      if settings.AWS_OK
        s3.get key, (e, r) ->
          if e and settings.LOCAL_STORAGE
            local.get key, cb
          else
            cb e, r
      else if settings.LOCAL_STORAGE
        local.get key, cb
      else
        cb 'no storage', null