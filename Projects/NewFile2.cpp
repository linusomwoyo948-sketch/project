#include <stdio.h>
int x=5;
int myFunction()
{
	
	printf("%d\n", --x);
}
int main()
{
	
	myFunction();
		printf("%d\n", x);
			printf("%d\n", x);
				printf("%d\n", ++x);
	return 0;
}