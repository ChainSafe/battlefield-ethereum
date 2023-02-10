module github.com/streamingfast/battlefield-ethereum

go 1.14

require (
	github.com/golang/protobuf v1.5.2
	github.com/google/go-cmp v0.5.9
	github.com/lithammer/dedent v1.1.0
	github.com/manifoldco/promptui v0.8.0
	github.com/spf13/cobra v1.5.0
	github.com/streamingfast/firehose-ethereum v1.3.3
	github.com/streamingfast/firehose-ethereum/types v0.0.0-20221129151535-42f0a2b8d76d
	github.com/streamingfast/jsonpb v0.0.0-20210811021341-3670f0aa02d0
	github.com/streamingfast/logging v0.0.0-20221209193439-bff11742bf4c
	github.com/stretchr/testify v1.8.0
	go.uber.org/zap v1.21.0
	golang.org/x/crypto v0.0.0-20220427172511-eb4f295cb31f
)

replace github.com/gorilla/rpc => github.com/dfuse-io/rpc v1.2.1-0.20200218195849-d2251f4fe50d
