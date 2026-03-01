#!/bin/sh
hurl \
  --test \
  --variables-file tests/hurl/env/${HURL_ENV:-local}.env \
  --variable timestamp=$(date +%s) \
  tests/hurl
