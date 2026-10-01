#include <stdio.h>
int main()
{
	char outcome;
	printf("enter your outcome:\n");
	scanf("%c", &outcome);

	switch(outcome)
	{
	case 'E':
		printf("Exeeding expectation");
		break;
	case 'M':
		printf("Meeting expectation");
		break;
	case 'A':
		printf("Approaching  expectation");
		break;
	case 'B':
		printf("Below expectation");
		break;
	default:
		printf("Enter a valid outcome");
		break;
	}
	return 0;
}
