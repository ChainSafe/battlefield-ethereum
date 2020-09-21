ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && cd .. && pwd )"

source "$ROOT/bin/library.sh"

main() {
  pushd "$ROOT" &> /dev/null

  copy_only=

  while getopts "hc" opt; do
    case $opt in
      h) usage && exit 0;;
      c) copy_only=true;;
      \?) usage_error "Invalid option: -$OPTARG";;
    esac
  done
  shift $((OPTIND-1))

  if [[ $copy_only == "" ]]; then
    ./bin/generate_local.sh
  fi

  recreate_data_directories oracle

  echo "Copying references file (data, .dmlog) to oracle files..."
  rm -rf $oracle_data_dir/geth &> /dev/null || true
  cp -a $miner_data_dir/geth $oracle_data_dir
  cp $syncer_log $oracle_log
  cp $syncer_deep_mind_log $oracle_deep_mind_log

  # TODO: Generate dfuse blocks log (check how it's done in nodeos-cloudbuild/deep-mind/compare)
}

usage_error() {
  message="$1"
  exit_code="$2"

  echo "ERROR: $message"
  echo ""
  usage
  exit ${exit_code:-1}
}

usage() {
  echo "usage: oracle.sh [-c]"
  echo ""
  echo "Run the local transaction generation script and replaced previous oracle reference"
  echo "data with the new one we just generated."
  echo ""
  echo "Options"
  echo "    -c          Do no run generate_local.sh and only copy over the last generated values"
  echo "    -h          Display help about this script"
}

main "$@"
