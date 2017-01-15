'use strict'

settings = require './settings'

module.exports = ->
  s3 = require('./s3')()
  local = require('./local')()
  checkDataDir: ->
    if settings.LOCAL_STORAGE
      local.checkDataDir()
  keys: (from, prefix, cb) ->
    if not settings.PREFER_LOCAL
      if settings.LOCAL_STORAGE
        local.keys from, prefix, (e, r) ->
          if e and settings.AWS_OK
            s3.keys from, prefix, cb
          else
            cb e, r
      else if settings.AWS_OK
        s3.keys from, prefix, cb
      else 
        cb 'no storage', null
    else
      if settings.AWS_OK
        s3.keys from, prefix, (e, r) ->
          if e and settings.LOCAL_STORAGE
            local.keys from, prefix, cb
          else
            cb e, r
      else if settings.LOCAL_STORAGE
        local.keys from, prefix, cb
      else
        cb 'no storage', null
  del: (key, cb) ->
    if settings.LOCAL_STORAGE
      local.del key, (e, r) ->
        if settings.AWS_OK
          s3.del key, cb
    else if settings.AWS_OK
      s3.del key, cb
  put: (key, o, cb, notCritical) ->
    console.log 'put', settings.LOCAL_STORAGE
    if settings.LOCAL_STORAGE
      local.put key, o, (e, r) ->
        if settings.AWS_OK and (not notCritical)
          s3.put key, o, cb
        else
          cb? e, r
    else if settings.AWS_OK and (not notCritical)
      s3.put key, o, cb
    else
      cb? null, null
  get: (key, cb) ->
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