#include <stdio.h>

int main() {
    int arr[5];
    int i;

    /* Input five numbers */
    printf("Enter five numbers:\n");
    for (i = 0; i < 5; i++) {
        scanf("%d", &arr[i]);
    }

    /* Display numbers in reverse order */
    printf("Numbers in reverse order:");
    for (i = 4; i >= 0; i--) {
        printf("%d ", arr[i]);
    }

    return 0;
}