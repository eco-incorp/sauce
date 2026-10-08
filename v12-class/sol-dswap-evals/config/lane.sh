#!/bin/bash
# lane.sh <mode>: the three models in turn, in that mode's directory.
mode=$1
E=/Users/er/Documents/Projects/v12-class/sol-dswap-evals
$E/config/run.sh $mode opus claude-opus-5-5
$E/config/run.sh $mode sonnet claude-sonnet-5-5
$E/config/run.sh $mode haiku claude-haiku-4-5-20251001
echo "lane $mode finished"
