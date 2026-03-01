#!/bin/sh
hurl \
  --test \
  --variables-file tests/hurl/env/${HURL_ENV:-local}.env \
  --variable timestamp=$(date +%s) \
  --variable date=$(date +%Y-%m-%d) \
  tests/hurl
