#include <stdio.h>
int main()
{
int number;
printf("enter the number:\n ");
scanf("%d", &number);

int count=1;
while(count <= 100)
{
	int product=number * count;
	printf("%d*%d=%d\n", number,count,product);
	count=count+2;
}
	
	return 0;
}