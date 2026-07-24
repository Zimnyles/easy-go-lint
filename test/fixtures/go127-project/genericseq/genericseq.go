package genericseq

type Sequence[T any] []T

func (sequence Sequence[T]) Map[U any](
	transform func(T) U,
) Sequence[U] {
	result := make(Sequence[U], 0, len(sequence))
	for _, value := range sequence {
		result = append(result, transform(value))
	}

	return result
}
