#include <stdio.h>
int main()
{
	int a;
	int b;
	int product;
	
	printf("enter num a:\n");
	scanf("%d", &a);
	printf("enter num b:\n");
	scanf("%d", &b);
	
	product=a*b;
	printf("product is %d", product);
	return 0;
}