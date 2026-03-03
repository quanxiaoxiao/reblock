#!/bin/bash

# Continuous test runner
# Run test-workflow until no LINKCOUNT_MISMATCH issues found

count=0
max_attempts=10

echo "🔄 Starting continuous test runner..."
echo "   Will run up to $max_attempts times or until no issues found"
echo ""

while [ $count -lt $max_attempts ]; do
  count=$((count + 1))
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📝 Test Run #$count"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  # Run test and capture output
  output=$(node scripts/test-workflow.mjs 2>&1)
  
  # Check if test passed
  if echo "$output" | grep -q "TEST PASSED"; then
    echo ""
    echo "🎉 SUCCESS! No issues found after $count attempts!"
    echo "$output" | tail -20
    exit 0
  else
    echo ""
    echo "⚠️  Issues still present, checking logs..."
    # Show summary
    echo "$output" | grep -E "(LINKCOUNT_MISMATCH|Total issues|Duration)" | tail -5
    echo ""
    
    if [ $count -lt $max_attempts ]; then
      echo "Waiting 3 seconds before next run..."
      sleep 3
    fi
  fi
done

echo ""
echo "❌ Reached maximum attempts ($max_attempts) without success"
echo "   Please check the logs and investigate further"
exit 1
