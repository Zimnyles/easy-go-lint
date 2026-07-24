package main

import (
	"fmt"
	"strconv"

	"example.com/easy-go-lint-go127/genericseq"
)

func main() {
	values := genericseq.Sequence[int]{1, 2, 3}
	fmt.Println(values.Map(strconv.Itoa))
}
