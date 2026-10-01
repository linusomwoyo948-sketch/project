#include <stdio.h>
int main()
{
	int number;
	int product;
	int count=1;
	
	printf("ENTER YOUR NUMBER:\n");
	scanf("%d", &number);
	
	while(count<=100)
	{
		product=number*count;
		printf("%d*%d=%d:\n", number, count, product);
		count++;
	}
	return 0;
}